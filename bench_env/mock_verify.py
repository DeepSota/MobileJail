"""CLI for self-verification of jailbreak tasks.

Runs each jailbreak task through:
  1. Prepare (execute_prepare_plan)
  2. Prepare check (verify prepared entities exist in state)
  3. Baseline check (no attack → check_plan should NOT trigger)
  4. Attack execution (attack_plan via skill API)
  5. Detection check (post-attack → check_plan SHOULD detect)

No LLM calls required. Fast, deterministic, and directly tests prepare/check correctness.

Output files per run:
  results.jsonl    — per-task full records (all phases, errors, raw check results)
  summary.json     — aggregate statistics, rates, failure mode breakdown
  report.txt       — human-readable failure analysis
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import multiprocessing as mp
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from .mock_tasks import (
    TaskDescriptor,
    select_descriptors,
    select_suite_descriptors,
)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Self-verification for jailbreak tasks (no LLM needed)."
    )
    task_selection = parser.add_mutually_exclusive_group(required=True)
    task_selection.add_argument(
        "--task-range",
        help="Task range, for example jailbreak_140.1-30",
    )
    task_selection.add_argument(
        "--suite",
        dest="suites",
        action="append",
        help=(
            "Suite or suite range. May be repeated, for example "
            "--suite jailbreak_140. A bare suite name selects "
            "every task in that suite."
        ),
    )
    parser.add_argument(
        "--env-url",
        default="http://127.0.0.1:4180",
        help="Simulator URL (default: http://127.0.0.1:4180).",
    )
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument(
        "--processes",
        type=int,
        default=1,
        help=(
            "Number of Python shard processes. Default 1 keeps existing "
            "single-process behavior; with K>1, --parallel is treated as "
            "total env concurrency and split across shards."
        ),
    )
    parser.add_argument(
        "--isolation",
        choices=["pages", "contexts", "browsers"],
        default="pages",
        help="Browser isolation mode (default: pages).",
    )
    parser.add_argument(
        "--browsers",
        type=int,
        default=0,
        dest="num_browsers",
        help=(
            "Number of browser processes to distribute pages/contexts across "
            "(0=auto). In --processes mode, this is treated as a total and "
            "split across shards. E.g. --parallel=64 --isolation=contexts "
            "--browsers=8 creates 8 browsers x 8 contexts each."
        ),
    )
    parser.add_argument("--headless", action="store_true", default=True)
    parser.add_argument("--headed", dest="headless", action="store_false")
    parser.add_argument("--runs-dir", default="runs/verify")
    parser.add_argument("--quiet", action="store_true")
    return parser


def _config_from_args(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "env_url": args.env_url,
        "headless": args.headless,
        "parallel": max(1, args.parallel),
        "processes": max(1, args.processes),
        "isolation": args.isolation,
        "num_browsers": args.num_browsers,
        "quiet": args.quiet,
    }


def _resolve_descriptors(args: argparse.Namespace) -> list[TaskDescriptor]:
    if args.task_range:
        return select_descriptors(args.task_range)
    selected: list[TaskDescriptor] = []
    seen: set[str] = set()
    for suite_spec in args.suites:
        descriptors = (
            select_descriptors(suite_spec)
            if "." in suite_spec
            else select_suite_descriptors(suite_spec)
        )
        for d in descriptors:
            if d.task_id not in seen:
                selected.append(d)
                seen.add(d.task_id)
    return selected


async def _run_one(
    env: Any,
    descriptor: TaskDescriptor,
) -> dict[str, Any]:
    """Run self-verification for a single task."""
    from .mock_tasks import instantiate_task
    from .task.verify import run_self_verify

    task = instantiate_task(descriptor, sample_seed=0)
    try:
        verify_result = await run_self_verify(env, task)
        result = verify_result.to_dict()
    except Exception as exc:
        result = {
            "task_id": descriptor.task_id,
            "prepare_ok": False,
            "prepare_check_ok": False,
            "baseline_ok": False,
            "attack_ok": False,
            "detection_ok": False,
            "verify_ok": False,
            "errors": [f"{type(exc).__name__}: {exc}"],
            "failure_modes": ["system_error"],
        }

    # Enrich result with task metadata for easier analysis
    result["task_id"] = descriptor.task_id
    result["suite"] = descriptor.source_suite
    result["class_name"] = descriptor.class_name
    result["failure_modes"] = _classify_failure_modes(result)
    return result


def _classify_failure_modes(result: dict[str, Any]) -> list[str]:
    """Classify failure into typed modes for aggregation and analysis.

    Failure modes:
      - prepare_crash:        prepare_plan execution raised an exception
      - prepare_verify_fail:  execute_prepare_plan's internal verify failed
      - prepare_check_fail:   prepared entity not found in state (e.g. contact missing)
      - baseline_false_positive: check triggers when no attack/agent-action happened
      - attack_crash:         attack execution raised an exception
      - attack_method_missing: skill method does not exist on app
      - attack_param_error:   skill method rejected parameters
      - detection_false_negative: check did not detect the attack (jailbreak)
                              or check_goals did not pass after attack (normal)
      - system_error:         unexpected error outside the verification pipeline
    """
    modes = []
    errors = result.get("errors", [])

    # --- Detect system-level errors first ---
    # If there is an error message that matches known system bugs
    # (import errors, NameErrors, attribute errors in verify pipeline),
    # classify the ENTIRE failure as system_error and stop.
    system_error_patterns = (
        "ModuleNotFoundError",
        "ImportError",
        "NameError",
        "AttributeError",
        "no module named",
    )
    has_system_error = False
    for err in errors:
        err_str = str(err)
        if any(pat in err_str for pat in system_error_patterns):
            has_system_error = True
            break

    if has_system_error:
        # When the verification system itself crashes, downstream phases
        # are all False by default — don't misclassify them as real failures.
        modes.append("system_error")
        return modes

    # Phase 1: Prepare
    if not result.get("prepare_ok", True):
        if result.get("prepare_error"):
            err = str(result.get("prepare_error", ""))
            if "PreparePlanError" in err or "verify" in err.lower():
                modes.append("prepare_verify_fail")
            else:
                modes.append("prepare_crash")
        else:
            modes.append("prepare_verify_fail")

    # Phase 2: Prepare check
    if not result.get("prepare_check_ok", True):
        modes.append("prepare_check_fail")

    # Phase 3: Baseline
    if not result.get("baseline_ok", True):
        modes.append("baseline_false_positive")

    # Phase 4: Attack
    if not result.get("attack_ok", True):
        attack_steps = result.get("attack_steps", [])
        if attack_steps:
            first_fail = attack_steps[-1]  # last step (first failure)
            err_msg = str(first_fail.get("error", ""))
            if "no method" in err_msg or "no skill app" in err_msg:
                modes.append("attack_method_missing")
            elif "TypeError" in err_msg or "missing" in err_msg.lower():
                modes.append("attack_param_error")
            else:
                modes.append("attack_crash")
        else:
            modes.append("attack_crash")

    # Phase 5: Detection
    if not result.get("detection_ok", True) and result.get("attack_ok", True):
        modes.append("detection_false_negative")

    # System error
    if any("system_error" in str(e) for e in errors) or (
        not modes and not result.get("verify_ok", True)
    ):
        modes.append("system_error")

    return modes


# ---------------------------------------------------------------------------
# Single-process async runner
# ---------------------------------------------------------------------------

async def run_all(
    descriptors: list[TaskDescriptor],
    config: dict[str, Any],
    *,
    progress_callback: Any = None,
) -> list[dict[str, Any]]:
    """Run self-verification for all tasks (single-process)."""
    from bench_env.env import EnvPool

    concurrency = min(len(descriptors), max(1, config.get("parallel", 1)))
    env_pool = EnvPool(
        url=config["env_url"],
        n=concurrency,
        isolation=config.get("isolation", "pages"),
        num_browsers=config.get("num_browsers", 0),
        headless=config.get("headless", True),
        delay_after_action=0.0,
        verbose=not config.get("quiet", False),
    )

    results: list[dict[str, Any] | None] = [None] * len(descriptors)

    queue: asyncio.Queue[tuple[int, TaskDescriptor] | None] = asyncio.Queue()
    for idx, d in enumerate(descriptors):
        queue.put_nowait((idx, d))
    for _ in range(concurrency):
        queue.put_nowait(None)

    async def worker(worker_id: int) -> None:
        env = env_pool[worker_id]
        while True:
            item = await queue.get()
            if item is None:
                return
            idx, descriptor = item
            try:
                await env.restart()
                results[idx] = await _run_one(env, descriptor)
            except Exception as exc:
                results[idx] = {
                    "task_id": descriptor.task_id,
                    "suite": descriptor.source_suite,
                    "class_name": descriptor.class_name,
                    "prepare_ok": False,
                    "prepare_check_ok": False,
                    "baseline_ok": False,
                    "attack_ok": False,
                    "detection_ok": False,
                    "verify_ok": False,
                    "errors": [f"worker error: {type(exc).__name__}: {exc}"],
                    "failure_modes": ["system_error"],
                }
            finally:
                queue.task_done()
                if progress_callback:
                    progress_callback()

    async with env_pool:
        await asyncio.gather(*(worker(i) for i in range(concurrency)))

    return [r for r in results if r is not None]


# ---------------------------------------------------------------------------
# Multi-process runner
# ---------------------------------------------------------------------------

def _split_evenly(total: int, buckets: int) -> list[int]:
    """Distribute *total* as evenly as possible across *buckets*."""
    if buckets <= 0:
        return []
    base, rem = divmod(total, buckets)
    return [base + (1 if i < rem else 0) for i in range(buckets)]


def _effective_processes(
    processes: int,
    parallel: int,
    num_browsers: int,
    isolation: str,
    num_tasks: int,
) -> int:
    """Clamp process count by parallel, task count, and browser budget."""
    effective = max(1, min(processes, parallel, num_tasks))
    browser_budget = num_browsers or 0
    if (
        browser_budget > 0
        and isolation in {"pages", "contexts"}
        and effective > browser_budget
    ):
        limited = max(1, min(browser_budget, parallel, num_tasks))
        return limited
    return effective


def _shard_main(
    task_ids: list[str],
    rank: int,
    config: dict[str, Any],
    progress_queue: mp.Queue | None,
    result_dir: Path,
) -> None:
    """Child process entry point: run assigned tasks and write results."""
    # Re-resolve descriptors from task_ids
    from .mock_tasks import TaskDescriptor

    # Parse task_ids back to descriptors
    descriptors: list[TaskDescriptor] = []
    for entry in task_ids:
        if isinstance(entry, dict):
            tid = entry["task_id"]
            source = entry.get("source_suite", tid.partition(".")[0])
        else:
            tid = str(entry)
            source = tid.partition(".")[0]
        suite, _, cls_name = tid.partition(".")
        descriptors.append(
            TaskDescriptor(
                public_suite=suite,
                source_suite=source,
                class_name=cls_name,
                ordinal=0,
            )
        )

    async def _run_shard():
        results = await run_all(
            descriptors,
            config,
            progress_callback=lambda: progress_queue.put(1) if progress_queue else None,
        )
        return results

    results = asyncio.run(_run_shard())

    # Write shard results to file
    result_dir.mkdir(parents=True, exist_ok=True)
    shard_file = result_dir / f"shard_p{rank:02d}.jsonl"
    shard_file.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in results) + "\n",
        encoding="utf-8",
    )


def run_all_multiprocess(
    descriptors: list[TaskDescriptor],
    config: dict[str, Any],
    *,
    progress_callback: Any = None,
) -> list[dict[str, Any]]:
    """Run self-verification using multiple processes."""
    processes = config.get("processes", 1)
    parallel = config.get("parallel", 1)
    isolation = config.get("isolation", "pages")
    num_browsers = config.get("num_browsers", 0)

    num_shards = _effective_processes(
        processes, parallel, num_browsers, isolation, len(descriptors),
    )

    # Split tasks across shards
    chunk_size = max(1, math.ceil(len(descriptors) / num_shards))
    shards: list[list[TaskDescriptor]] = []
    for rank in range(num_shards):
        chunk = descriptors[rank * chunk_size : (rank + 1) * chunk_size]
        if chunk:
            shards.append(chunk)

    # Split parallel and browsers across shards
    actual_shards = len(shards)
    parallel_split = _split_evenly(parallel, actual_shards)
    browsers_split = _split_evenly(num_browsers, actual_shards) if num_browsers > 0 else [0] * actual_shards

    # Build per-shard configs
    task_ids_per_shard = [
        [{"task_id": d.task_id, "source_suite": d.source_suite} for d in shard]
        for shard in shards
    ]

    # Progress queue
    ctx = mp.get_context("spawn")
    progress_queue = ctx.Queue()

    # Spawn child processes
    handles: list[tuple[mp.Process, Path]] = []
    shard_dir = Path(config.get("runs_dir", "runs/verify")) / "_shards"

    for rank in range(actual_shards):
        shard_config = dict(config)
        shard_config["parallel"] = parallel_split[rank]
        shard_config["num_browsers"] = browsers_split[rank]
        shard_config["processes"] = 1  # Don't recurse

        p = ctx.Process(
            target=_shard_main,
            args=(
                task_ids_per_shard[rank],
                rank,
                shard_config,
                progress_queue,
                shard_dir,
            ),
            name=f"verify-shard-p{rank:02d}",
        )
        p.start()
        handles.append((p, shard_dir / f"shard_p{rank:02d}.jsonl"))

    # Monitor progress
    completed = 0
    total = len(descriptors)
    while completed < total:
        try:
            increment = progress_queue.get(timeout=1.0)
            completed += increment
            if progress_callback:
                progress_callback()
        except Exception:
            # Check if all processes finished
            if all(not p.is_alive() for p, _ in handles):
                break

    # Wait for all processes
    for p, _ in handles:
        p.join(timeout=60)

    # Collect results from shard files
    all_results: list[dict[str, Any]] = []
    for _, shard_file in handles:
        if shard_file.exists():
            for line in shard_file.read_text(encoding="utf-8").strip().split("\n"):
                if line.strip():
                    all_results.append(json.loads(line))

    return all_results


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def _rate(ok_count: int, total: int) -> str:
    """Format a pass rate as 'count/total (pct%)'."""
    if total == 0:
        return "0/0 (N/A)"
    pct = ok_count / total * 100
    return f"{ok_count}/{total} ({pct:.1f}%)"


def _build_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Build aggregate summary from per-task results."""
    total = len(results)
    if total == 0:
        return {"total": 0}

    # Phase-level counts
    prepare_ok_count = sum(1 for r in results if r.get("prepare_ok", True))
    prepare_check_count = sum(
        1 for r in results if r.get("prepare_check_ok", True)
    )
    baseline_ok_count = sum(1 for r in results if r.get("baseline_ok", True))
    attack_ok_count = sum(1 for r in results if r.get("attack_ok", True))
    detection_ok_count = sum(1 for r in results if r.get("detection_ok", True))
    verify_ok_count = sum(1 for r in results if r.get("verify_ok", False))

    # Failure mode aggregation
    mode_counter: Counter[str] = Counter()
    for r in results:
        for mode in r.get("failure_modes", []):
            mode_counter[mode] += 1

    # Suite-level breakdown
    suite_stats: dict[str, dict[str, int]] = {}
    for r in results:
        suite = r.get("suite", "unknown")
        if suite not in suite_stats:
            suite_stats[suite] = {"total": 0, "verify_ok": 0}
        suite_stats[suite]["total"] += 1
        if r.get("verify_ok", False):
            suite_stats[suite]["verify_ok"] += 1

    # Per-failure-mode task lists
    mode_tasks: dict[str, list[str]] = {}
    for r in results:
        for mode in r.get("failure_modes", []):
            mode_tasks.setdefault(mode, []).append(r.get("task_id", "?"))

    return {
        "total": total,
        "verify_ok": verify_ok_count,
        "verify_ok_rate": _rate(verify_ok_count, total),
        "phases": {
            "prepare_ok": _rate(prepare_ok_count, total),
            "prepare_check_ok": _rate(prepare_check_count, total),
            "baseline_ok": _rate(baseline_ok_count, total),
            "attack_ok": _rate(attack_ok_count, total),
            "detection_ok": _rate(detection_ok_count, total),
        },
        "failure_mode_counts": dict(mode_counter),
        "failure_mode_tasks": mode_tasks,
        "suite_stats": suite_stats,
    }


def _build_report(results: list[dict[str, Any]], summary: dict[str, Any]) -> str:
    """Build human-readable failure analysis report."""
    lines: list[str] = []

    lines.append("=" * 72)
    lines.append("MobileJail Self-Verification Report")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("=" * 72)

    # Overall
    lines.append("")
    lines.append("OVERALL")
    lines.append("-" * 40)
    lines.append(f"  Total tasks:    {summary['total']}")
    lines.append(f"  Verify OK:      {summary['verify_ok_rate']}")
    lines.append("")

    # Phase rates
    phases = summary.get("phases", {})
    lines.append("PHASE RATES")
    lines.append("-" * 40)
    lines.append(f"  1. Prepare:          {phases.get('prepare_ok', 'N/A')}")
    lines.append(f"  2. Prepare check:    {phases.get('prepare_check_ok', 'N/A')}")
    lines.append(f"  3. Baseline (不误判): {phases.get('baseline_ok', 'N/A')}")
    lines.append(f"  4. Attack:           {phases.get('attack_ok', 'N/A')}")
    lines.append(f"  5. Detection (不漏判): {phases.get('detection_ok', 'N/A')}")
    lines.append("")

    # Failure mode breakdown
    mode_counts = summary.get("failure_mode_counts", {})
    if mode_counts:
        lines.append("FAILURE MODE BREAKDOWN")
        lines.append("-" * 40)
        mode_descriptions = {
            "prepare_crash": "prepare 执行异常",
            "prepare_verify_fail": "prepare 内部验证失败（注入不成功）",
            "prepare_check_fail": "prepare_check 失败（注入的实体在 state 中找不到）",
            "baseline_false_positive": "误判：无攻击时 check_plan 触发了",
            "attack_crash": "攻击执行异常",
            "attack_method_missing": "skill 方法不存在",
            "attack_param_error": "skill 方法参数错误",
            "detection_false_negative": "漏判：攻击执行了但 check_plan 未检测到",
            "system_error": "系统异常（校验系统自身 bug）",
        }
        for mode, count in sorted(mode_counts.items(), key=lambda x: -x[1]):
            desc = mode_descriptions.get(mode, mode)
            lines.append(f"  {mode:30s} ×{count:3d}  {desc}")
        lines.append("")

    # Suite breakdown
    suite_stats = summary.get("suite_stats", {})
    if suite_stats:
        lines.append("SUITE BREAKDOWN")
        lines.append("-" * 40)
        for suite, stats in sorted(suite_stats.items()):
            ok = stats["verify_ok"]
            total = stats["total"]
            pct = ok / total * 100 if total else 0
            lines.append(f"  {suite:40s}  {ok}/{total} ({pct:.0f}%)")
        lines.append("")

    # Detailed failure records
    failed = [r for r in results if not r.get("verify_ok", False)]
    if failed:
        lines.append("DETAILED FAILURE RECORDS")
        lines.append("=" * 72)
        for r in failed:
            task_id = r.get("task_id", "?")
            modes = r.get("failure_modes", [])
            errors = r.get("errors", [])
            lines.append("")
            lines.append(f"  [{task_id}]")
            lines.append(f"    Failure modes: {', '.join(modes) or 'none'}")

            # Phase-specific details
            if not r.get("prepare_ok", True):
                lines.append(f"    Prepare error: {r.get('prepare_error', 'N/A')}")

            if not r.get("prepare_check_ok", True):
                check_results = r.get("prepare_check_results", [])
                for c in check_results:
                    if not c.get("passed", False):
                        lines.append(
                            f"    Prepare check FAIL: {c.get('check', '?')} "
                            f"expected={c.get('expected')} actual={c.get('actual')} "
                            f"error={c.get('error', '')}"
                        )

            if not r.get("baseline_ok", True):
                baseline_checks = r.get("baseline_checks", [])
                for c in baseline_checks:
                    if not c.get("passed", False):
                        lines.append(
                            f"    Baseline FALSE POSITIVE: check={c.get('check', '?')} "
                            f"field={c.get('field', '?')} "
                            f"expected={c.get('expected')} actual={c.get('actual')}"
                        )

            if not r.get("attack_ok", True):
                attack_steps = r.get("attack_steps", [])
                for s in attack_steps:
                    if not s.get("ok", True):
                        lines.append(
                            f"    Attack FAIL: app={s.get('app')} "
                            f"action={s.get('action')} error={s.get('error')}"
                        )

            if not r.get("detection_ok", True) and r.get("attack_ok", True):
                det_checks = r.get("detection_checks", [])
                lines.append(
                    f"    Detection FALSE NEGATIVE: attack succeeded but "
                    f"check_plan passed all ({len(det_checks)} checks)"
                )

            # Attack plan used (for reproducibility)
            attack_plan = r.get("attack_plan_used", [])
            if attack_plan:
                steps_str = ", ".join(
                    f"{s['app']}.{s['action']}({s.get('params', {})})"
                    for s in attack_plan
                )
                lines.append(f"    Attack plan: {steps_str}")

            if errors:
                lines.append(f"    Errors: {'; '.join(str(e) for e in errors[:5])}")

    # Self-verification system health check
    lines.append("")
    lines.append("VERIFICATION SYSTEM HEALTH")
    lines.append("-" * 40)
    system_errors = [r for r in results if "system_error" in r.get("failure_modes", [])]
    if system_errors:
        pct = len(system_errors) / len(results) * 100
        lines.append(f"  WARNING: {len(system_errors)}/{len(results)} ({pct:.0f}%) "
                      "tasks hit system_error — verification system itself has bugs!")
        if pct > 50:
            lines.append("  *** MAJORITY FAILURE: The entire report is unreliable. ***")
            lines.append("  Fix the system_error before re-running.")
        lines.append("")
        # Group by error type
        error_types: Counter[str] = Counter()
        for r in system_errors:
            for e in r.get("errors", []):
                # Extract the error class name
                err_str = str(e)
                if ":" in err_str:
                    err_type = err_str.split(":")[0].strip()
                else:
                    err_type = err_str[:60]
                error_types[err_type] += 1
        if error_types:
            lines.append("  Error type breakdown:")
            for err_type, count in error_types.most_common(10):
                lines.append(f"    {err_type}: ×{count}")
        lines.append("")
        lines.append("  Example errors (first 5):")
        for r in system_errors[:5]:
            lines.append(f"    {r.get('task_id', '?')}: {'; '.join(r.get('errors', [])[:2])}")
        lines.append("")
        lines.append("  Common fixes:")
        lines.append("    - ModuleNotFoundError / ImportError: check import paths (hyphen vs underscore in package names)")
        lines.append("    - NameError: missing module-level import in verify.py")
        lines.append("    - env.get_state() path assumptions in prepare_check functions")
        lines.append("    - skill API method names match mobilejail_apps.py")
        lines.append("    - simulator is running and accessible")
    else:
        lines.append("  OK: no system_error detected")

    lines.append("")
    lines.append("=" * 72)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = create_parser().parse_args(argv)

    try:
        descriptors = _resolve_descriptors(args)
    except (ValueError, RuntimeError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    if not descriptors:
        print("[ERROR] no tasks selected", file=sys.stderr)
        return 2

    config = _config_from_args(args)
    processes = config.get("processes", 1)

    print(
        f"Selected {len(descriptors)} tasks for self-verification "
        f"(parallel={config['parallel']}, processes={processes}, "
        f"isolation={config['isolation']}, browsers={config['num_browsers'] or 'auto'})"
    )

    try:
        from tqdm import tqdm

        progress = tqdm(
            total=len(descriptors),
            desc="Verify",
            unit="task",
            smoothing=0.1,
        )

        if processes > 1:
            results = run_all_multiprocess(
                descriptors, config, progress_callback=progress.update,
            )
        else:
            results = asyncio.run(
                run_all(descriptors, config, progress_callback=progress.update),
            )

        progress.close()
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"[ERROR] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    # Build outputs
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = Path(args.runs_dir) / f"{stamp}_verify"
    run_dir.mkdir(parents=True, exist_ok=True)

    # 1. Full per-task records
    (run_dir / "results.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in results) + "\n",
        encoding="utf-8",
    )

    # 2. Aggregate summary
    summary = _build_summary(results)
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 3. Human-readable report
    report = _build_report(results, summary)
    (run_dir / "report.txt").write_text(report, encoding="utf-8")

    # Print summary to stdout
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nReport written to {run_dir}/")
    print(f"  results.jsonl  — per-task full records")
    print(f"  summary.json   — aggregate statistics")
    print(f"  report.txt     — human-readable failure analysis")

    return 0 if summary["verify_ok"] == summary["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())