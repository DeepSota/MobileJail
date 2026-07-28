"""CLI for the state-only MobileJail CodeAgent benchmark."""

from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing as mp
import os
import re
import sys
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
        description=(
            "Run MobileJail tasks through mobilejail-app-control without "
            "screenshot reasoning or coordinate clicks."
        )
    )
    task_selection = parser.add_mutually_exclusive_group(required=True)
    task_selection.add_argument(
        "--task-range",
        help="Aggregate task range, for example jailbreak_140.1-40",
    )
    task_selection.add_argument(
        "--suite",
        dest="suites",
        action="append",
        help=(
            "Aggregate suite or suite range. May be repeated, for example "
            "--suite normal_50.1-50 --suite jailbreak_140.1-40. A bare "
            "suite name selects every task in that suite."
        ),
    )
    parser.add_argument("--agent", choices=["codeagent"], default="codeagent")
    parser.add_argument(
        "--model-name",
        default=os.environ.get("MODEL_NAME", "Qwen3.5-122B-A10B"),
    )
    parser.add_argument(
        "--model-base-url",
        default=os.environ.get("MODEL_BASE_URL"),
    )
    parser.add_argument(
        "--model-api-key",
        default=os.environ.get("MODEL_API_KEY", ""),
    )
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--top-p", type=float, default=1.0)
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--infer-timeout", type=float, default=300.0)
    parser.add_argument("--code-timeout", type=float, default=30.0)
    parser.add_argument("--episode-timeout", type=float, default=180.0)

    parser.add_argument("--env-url", required=False)
    parser.add_argument("--headless", action="store_true", default=False)
    parser.add_argument("--proxy")
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument("--processes", type=int, default=1)
    parser.add_argument("--browsers", type=int, default=0)
    parser.add_argument(
        "--isolation",
        choices=["pages", "contexts", "browsers"],
        default="pages",
    )
    parser.add_argument("--sample-seed", type=int, default=0)
    parser.add_argument("--runs-dir", default="runs/mock_run")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve and print tasks without starting browsers or calling a model.",
    )
    return parser


def _distribute(total: int, parts: int) -> list[int]:
    total = max(0, int(total))
    parts = max(1, int(parts))
    base, extra = divmod(total, parts)
    return [base + (1 if index < extra else 0) for index in range(parts)]


def _partition(
    descriptors: list[TaskDescriptor],
    parts: int,
) -> list[list[TaskDescriptor]]:
    out = [[] for _ in range(max(1, parts))]
    for index, descriptor in enumerate(descriptors):
        out[index % len(out)].append(descriptor)
    return out


def _safe_slug(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_.-]+", "_", value)
    return value.strip("._") or "run"


def _config_from_args(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "env_url": args.env_url,
        "headless": args.headless,
        "proxy": args.proxy,
        "parallel": max(1, args.parallel),
        "browsers": max(0, args.browsers),
        "isolation": args.isolation,
        "model_name": args.model_name,
        "model_base_url": args.model_base_url,
        "model_api_key": args.model_api_key,
        "temperature": args.temperature,
        "top_p": args.top_p,
        "max_tokens": args.max_tokens,
        "infer_timeout": args.infer_timeout,
        "code_timeout": args.code_timeout,
        "episode_timeout": args.episode_timeout,
        "sample_seed": args.sample_seed,
        "quiet": args.quiet,
    }


def _process_entry(
    shard_id: int,
    descriptors: list[TaskDescriptor],
    config: dict[str, Any],
    output_queue: Any,
) -> None:
    try:
        from .mock_runner import run_shard

        results = asyncio.run(run_shard(descriptors, config))
        output_queue.put(
            {"type": "results", "shard": shard_id, "results": results}
        )
    except BaseException as exc:
        output_queue.put(
            {
                "type": "fatal",
                "shard": shard_id,
                "error": f"{type(exc).__name__}: {exc}",
            }
        )


def _run_multiprocess(
    descriptors: list[TaskDescriptor],
    config: dict[str, Any],
    processes: int,
) -> list[dict[str, Any]]:
    process_count = min(max(1, processes), len(descriptors))
    shards = _partition(descriptors, process_count)
    parallel_counts = _distribute(config["parallel"], process_count)
    browser_counts = _distribute(config["browsers"], process_count)
    context = mp.get_context("spawn")
    output_queue = context.Queue()
    workers = []
    for shard_id, shard in enumerate(shards):
        shard_config = dict(config)
        shard_config["parallel"] = max(1, parallel_counts[shard_id])
        shard_config["browsers"] = browser_counts[shard_id]
        process = context.Process(
            target=_process_entry,
            args=(shard_id, shard, shard_config, output_queue),
            name=f"mock-bench-shard-{shard_id}",
        )
        process.start()
        workers.append(process)

    messages = [output_queue.get() for _ in workers]
    for process in workers:
        process.join()

    fatals = [message for message in messages if message["type"] == "fatal"]
    if fatals:
        details = "; ".join(
            f"shard {item['shard']}: {item['error']}" for item in fatals
        )
        raise RuntimeError(f"one or more shards failed: {details}")

    results = [
        result
        for message in sorted(messages, key=lambda item: item["shard"])
        for result in message["results"]
    ]
    order = {descriptor.task_id: descriptor.ordinal for descriptor in descriptors}
    results.sort(key=lambda item: order.get(item.get("id", ""), 10**9))
    return results


def _run_dir(args: argparse.Namespace) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model = _safe_slug(args.model_name)
    return Path(args.runs_dir) / f"{stamp}_{model}_codeagent"


def _resolve_descriptors(args: argparse.Namespace) -> list[TaskDescriptor]:
    """Resolve one range or the ordered, de-duplicated ``--suite`` values."""
    if args.task_range:
        return select_descriptors(args.task_range)

    selected: list[TaskDescriptor] = []
    seen_task_ids: set[str] = set()
    for suite_spec in args.suites:
        descriptors = (
            select_descriptors(suite_spec)
            if "." in suite_spec
            else select_suite_descriptors(suite_spec)
        )
        for descriptor in descriptors:
            if descriptor.task_id not in seen_task_ids:
                selected.append(descriptor)
                seen_task_ids.add(descriptor.task_id)
    return selected


def main(argv: list[str] | None = None) -> int:
    args = create_parser().parse_args(argv)
    try:
        descriptors = _resolve_descriptors(args)
    except (ValueError, RuntimeError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        for descriptor in descriptors:
            print(
                f"{descriptor.ordinal:03d} {descriptor.task_id} "
                f"(source={descriptor.source_suite})"
            )
        print(f"Total: {len(descriptors)}")
        return 0

    if sys.version_info < (3, 10):
        print(
            "[ERROR] live execution requires Python 3.10+ because bench_env "
            f"uses PEP 604 runtime types; current={sys.version.split()[0]}. "
            "Use a Python 3.12 virtual environment.",
            file=sys.stderr,
        )
        return 2
    if not args.env_url:
        print("[ERROR] --env-url is required", file=sys.stderr)
        return 2
    if not args.model_base_url:
        print(
            "[ERROR] --model-base-url or MODEL_BASE_URL is required",
            file=sys.stderr,
        )
        return 2
    if not args.model_api_key:
        print(
            "[ERROR] --model-api-key or MODEL_API_KEY is required",
            file=sys.stderr,
        )
        return 2

    config = _config_from_args(args)
    try:
        if args.processes > 1:
            results = _run_multiprocess(
                descriptors,
                config,
                args.processes,
            )
        else:
            from .mock_runner import run_shard

            results = asyncio.run(run_shard(descriptors, config))
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"[ERROR] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    run_dir = _run_dir(args)
    meta = {
        "runner": "bench_env.mock_run",
        "agent": "codeagent",
        "task_range": args.task_range,
        "suites": args.suites,
        "task_ids": [descriptor.task_id for descriptor in descriptors],
        "model_name": args.model_name,
        "model_base_url": args.model_base_url,
        "model_api_key": "[REDACTED]",
        "env_url": args.env_url,
        "parallel": args.parallel,
        "processes": args.processes,
        "browsers": args.browsers,
        "isolation": args.isolation,
        "headless": args.headless,
    }
    from .mock_runner import write_results

    summary = write_results(run_dir, results, meta)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
