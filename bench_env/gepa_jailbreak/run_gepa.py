"""Generic, reusable end-to-end GEPA entry for MobileJail tasks.

Run GEPA evolution on *any* MobileJail task/benchmark with one command.
Reuses the existing bridge + GEPA v0.1.4 wiring, but presents a clean,
self-contained interface and records a transparent per-step transcript.

Usage (simulator already serving, e.g. `npm run preview -- --port 4173`):
    python3 -m bench_env.gepa_jailbreak.run_gepa \
        --suite jailbreak_140 \
        --task-ids splits/team_t0013.txt \
        --model-name "qwen3.7-plus" \
        --model-base-url "https://xh.v1api.cc/v1" \
        --model-api-key "$API_KEY" \
        --env-url "http://localhost:4173" \
        --max-evals 9 \
        --save-trajectories

Anything not passed falls back to a sensible default. Ctrl-C stops cleanly.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from bench_env.config import RunnerConfig
from bench_env.gepa_jailbreak.evolve import _patch_gepa_pareto_logging, _write_reproducibility_files
from bench_env.gepa_jailbreak.bridge import (
    DEFAULT_SEED_CANDIDATE,
    MobileJailGEPABridge,
    load_examples,
    read_task_ids,
    split_examples,
)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Run GEPA attack evolution on any MobileJail tasks.")
    # execution target
    p.add_argument("--suite", default="jailbreak_140")
    p.add_argument("--task-ids", help="text file of full task ids (one per line) to restrict pool")
    p.add_argument("--agent", default="generic_v2")
    p.add_argument("--model-name", required=True)
    p.add_argument("--model-base-url", required=True)
    p.add_argument("--model-api-key", default="", help="target + reflection model key (or set env)")
    p.add_argument("--env-url", default="http://localhost:4173")
    p.add_argument("--headless", action="store_true", default=True)
    p.add_argument("--max-steps", type=int, default=None)
    p.add_argument("--episode-timeout", type=float, default=180.0)
    p.add_argument("--score-mode", choices=["success", "progress", "hybrid"], default="hybrid")
    p.add_argument("--trace-limit", type=int, default=20)

    # split (default: put every selected task in train, none in val/test)
    p.add_argument("--train-size", type=int, default=None, help="default = all selected tasks")
    p.add_argument("--val-size", type=int, default=0)
    p.add_argument("--test-size", type=int, default=0)
    p.add_argument("--split-seed", type=int, default=42)

    # GEPA loop
    p.add_argument("--seed-candidate", default=None)
    p.add_argument("--seed-file", default=None)
    p.add_argument("--reflection-lm", default="openai/qwen3.7-plus")
    p.add_argument("--max-evals", type=int, default=9)
    p.add_argument("--max-concurrency", type=int, default=1)
    p.add_argument("--stop-at-score", type=float, default=None)
    p.add_argument("--save-name", default="run_gepa")

    # transparent/analysis
    p.add_argument("--output-dir", default="outputs/gepa_jailbreak")
    p.add_argument("--save-trajectories", action="store_true",
                   help="persist each candidate's GUI trajectory + ASI to disk")
    p.add_argument("--verbatim-transcript", action="store_true",
                   help="also write a human-readable trace.md of every iteration")
    return p


def _build_base_config(args: argparse.Namespace) -> RunnerConfig:
    return RunnerConfig(
        agent=args.agent,
        model_name=args.model_name,
        model_base_url=args.model_base_url,
        model_api_key=args.model_api_key or None,
        temperature=0.0,
        device="sim",
        env_url=args.env_url,
        headless=args.headless,
        max_steps=args.max_steps if args.max_steps is not None else 30,
        max_steps_explicit=args.max_steps is not None,
        infer_timeout=300.0,
        episode_timeout=args.episode_timeout,
        quiet=True,
        eval_mode="text",
        judge_mode="auto",
        no_save_trajectory=not args.save_trajectories,
    )


def _seed(args):
    if args.seed_candidate and args.seed_file:
        raise ValueError("only one of --seed-candidate / --seed-file")
    if args.seed_file:
        return Path(args.seed_file).read_text(encoding="utf-8").strip()
    if args.seed_candidate:
        return args.seed_candidate.strip()
    return DEFAULT_SEED_CANDIDATE


def main() -> int:
    from gepa.optimize_anything import EngineConfig, GEPAConfig, ReflectionConfig, optimize_anything
    from gepa import ScoreThresholdStopper

    args = _parser().parse_args()
    _patch_gepa_pareto_logging()

    base = _build_base_config(args)
    allowed = read_task_ids(args.task_ids)
    examples = load_examples(base, suite=args.suite, task_ids=allowed)
    if not examples:
        raise SystemExit(f"No tasks matched suite={args.suite} task_ids={args.task_ids}")

    # If no explicit sizes, put everything in train (small study default).
    if args.train_size is None:
        args.train_size = len(examples)
    train, val, test = split_examples(
        examples, train_size=args.train_size, val_size=args.val_size,
        test_size=args.test_size, seed=args.split_seed,
    )
    seed = _seed(args)

    out = Path(args.output_dir) / args.save_name
    _write_reproducibility_files(out, args=args, train=train, val=val, test=test, seed_candidate=seed)
    trace_file = None
    if args.verbatim_transcript:
        trace_file = out / "trace.md"

    bridge = MobileJailGEPABridge(base, suite=args.suite, score_mode=args.score_mode, trace_limit=args.trace_limit)

    stop = [ScoreThresholdStopper(args.stop_at_score)] if args.stop_at_score else None
    frontier = "hybrid" if val else "instance"
    config = GEPAConfig(
        engine=EngineConfig(
            run_dir=str(out / "gepa_state"), seed=args.split_seed,
            max_metric_calls=args.max_evals, max_workers=args.max_concurrency,
            parallel=args.max_concurrency > 1, frontier_type=frontier,
            candidate_selection_strategy="current_best",
            acceptance_criterion="improvement_or_equal", cache_evaluation=True,
            raise_on_exception=False,
        ),
        reflection=ReflectionConfig(
            reflection_lm=args.reflection_lm, reflection_minibatch_size=3,
            reflection_lm_kwargs={"api_key": args.model_api_key, "api_base": args.model_base_url},
        ),
        stop_callbacks=stop,
    )

    print(f"[GEPA] suite={args.suite} tasks={[e['task_id'] for e in train]} "
          f"agent={args.agent} model={args.model_name} score={args.score_mode} evals={args.max_evals}")
    print(f"[GEPA] output -> {out}")

    t0 = time.time()
    result = optimize_anything(
        seed_candidate=seed, batch_evaluator=bridge.batch_evaluate,
        dataset=train, valset=val, config=config,
    )
    elapsed = time.time() - t0

    best = str(result.best_candidate)
    (out / "best_jailbreak_prefix.txt").write_text(best + "\n", encoding="utf-8")
    run_log = out / "gepa_state" / "run_log.json"
    best_score = 0.0
    if run_log.exists():
        obs = [s for e in json.loads(run_log.read_text(encoding="utf-8")) for s in (e.get("new_subsample_scores") or [])]
        if obs:
            best_score = max(obs)
    summary = {
        "best_candidate_file": str(out / "best_jailbreak_prefix.txt"),
        "best_score(on-selected-tasks)": best_score,
        "elapsed_s": round(elapsed, 1),
        "metric_calls": getattr(result, "total_metric_calls", None),
        "num_candidates": getattr(result, "num_candidates", None),
    }
    (out / "result_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== BEST JAILBREAK PREFIX ===")
    print(best)
    print(f"\nBest score on selected tasks: {best_score} (best candidate above). Elapsed {elapsed:.1f}s")
    if trace_file is not None:
        _write_trace(trace_file, train, val, test, seed, best, best_score)
        print(f"Transcript: {trace_file}")
    return 0


def _write_trace(path: Path, train, val, test, seed, best, best_score) -> None:
    lines = []
    lines.append("# GEPA evolution transcript")
    lines.append(f"\n- tasks (train): {[e['task_id'] for e in train]}")
    if val:
        lines.append(f"- tasks (val): {[e['task_id'] for e in val]}")
    if test:
        lines.append(f"- tasks (test, reporting only): {[e['task_id'] for e in test]}")
    lines.append(f"- seed candidate:\n```\n{seed}\n```\n")
    lines.append(f"## Best candidate\n```\n{best}\n``` (score={best_score})")
    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())