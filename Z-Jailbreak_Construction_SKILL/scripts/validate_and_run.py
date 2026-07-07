#!/usr/bin/env python3
"""One-shot validation for generated jailbreak JSON suites.

This script is intentionally boring: it runs the same gates a maintainer would
run by hand, in order, and stops at the first failing command.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "Z-越狱构建" / "task.json"
DEFAULT_SUITE = "jailbreak_json"
MIN_PYTHON = (3, 11)


def _run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    rel_cmd = " ".join(cmd)
    print(f"\n$ {rel_cmd}", flush=True)
    merged_env = os.environ.copy()
    merged_env["PYTHONDONTWRITEBYTECODE"] = "1"
    if env:
        merged_env.update(env)
    subprocess.run(cmd, cwd=REPO_ROOT, env=merged_env, check=True)


def _python_version(python: Path) -> tuple[int, int, int] | None:
    try:
        proc = subprocess.run(
            [str(python), "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        )
    except Exception:
        return None
    parts = proc.stdout.strip().split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    return int(parts[0]), int(parts[1]), int(parts[2])


def _candidate_pythons(explicit: str | None) -> list[Path]:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    env_python = os.environ.get("MOBILEGYM_VALIDATION_PYTHON")
    if env_python:
        candidates.append(Path(env_python))
    candidates.extend([
        REPO_ROOT / ".venv-py312" / "bin" / "python",
        REPO_ROOT / ".venv" / "bin" / "python",
        Path("/home/public/.local/bin/python3.12"),
    ])
    for name in ("python3.12", "python3.11", "python3", "python"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))

    out: list[Path] = []
    seen: set[str] = set()
    for item in candidates:
        key = str(item)
        if key not in seen:
            out.append(item)
            seen.add(key)
    return out


def choose_python(explicit: str | None) -> Path:
    rejected: list[str] = []
    for python in _candidate_pythons(explicit):
        version = _python_version(python)
        if version is None:
            rejected.append(f"{python}: not executable")
            continue
        if version[:2] >= MIN_PYTHON:
            print(f"Using Python: {python} ({'.'.join(map(str, version))})")
            return python
        rejected.append(f"{python}: {'.'.join(map(str, version))} < 3.11")
    details = "\n  ".join(rejected) if rejected else "(none found)"
    raise SystemExit(
        "No Python >= 3.11 found for bench_env validation.\n"
        f"Checked:\n  {details}"
    )


def install_deps(python: Path) -> None:
    uv = shutil.which("uv") or "/home/public/.local/bin/uv"
    if Path(uv).exists():
        _run([
            uv,
            "pip",
            "install",
            "--python",
            str(python),
            "-r",
            "bench_env/requirements.txt",
        ], env={"UV_CACHE_DIR": str(REPO_ROOT / ".uv-cache")})
        return
    _run([str(python), "-m", "pip", "install", "-r", "bench_env/requirements.txt"])


def check_adv_task0_layout() -> None:
    nested = [
        path
        for path in (
            REPO_ROOT / "bench_env" / "adv_task0" / "adv_task",
            REPO_ROOT / "bench_env" / "adv_task0" / "adv_task0",
            REPO_ROOT / "bench_env" / "adv_task",
        )
        if path.exists()
    ]
    if nested:
        listed = "\n".join(f"  - {path.relative_to(REPO_ROOT)}" for path in nested)
        raise SystemExit(f"Stale duplicate adv_task path(s) found:\n{listed}")
    print("OK: adv_task0 layout is unified")


def check_task_range_loading(python: Path, suite: str) -> None:
    code = f"""
from bench_env.run import create_parser, _apply_runtime_defaults, _expand_task_range
from bench_env.config import RunnerConfig
from bench_env import factory

args = create_parser().parse_args([
    "--task-range", {suite!r} + ".1-2",
])
_apply_runtime_defaults(args)
if args.suite != {suite!r}:
    raise SystemExit(f"expected inferred suite {{ {suite!r} }}, got {{args.suite!r}}")
if not args.env_url:
    raise SystemExit("expected jailbreak_json task-range to set default env_url")
if not args.headless:
    raise SystemExit("expected jailbreak_json task-range to default to headless")
if (args.parallel, args.processes, args.num_browsers, args.isolation) != (32, 4, 8, "pages"):
    raise SystemExit(
        "unexpected jailbreak_json runtime defaults: "
        f"parallel={{args.parallel}}, processes={{args.processes}}, "
        f"browsers={{args.num_browsers}}, isolation={{args.isolation}}"
    )
expanded = _expand_task_range(args.task_range)
if len(expanded) != 2:
    raise SystemExit(f"expected 2 expanded task ids, got {{len(expanded)}}")
args.task_ids = ",".join(expanded)
args.task_id = None
tasks = factory.load_tasks(RunnerConfig.from_args(args))
if len(tasks) != 2:
    raise SystemExit(f"expected 2 loaded tasks, got {{len(tasks)}}")
bad = [task.id for task in tasks if not task.id.startswith({suite!r} + ".")]
if bad:
    raise SystemExit(f"loaded tasks outside generated suite: {{bad}}")
print(f"OK: task-range load smoke loaded {{len(tasks)}} generated tasks")
""".strip()
    _run([str(python), "-c", code])


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and validate a generated jailbreak JSON suite.")
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--suite", default=DEFAULT_SUITE)
    parser.add_argument("--python", help="Python >=3.11 interpreter to use for pytest/runtime imports")
    parser.add_argument("--install-deps", action="store_true", help="Install bench_env/requirements.txt before running pytest")
    parser.add_argument("--skip-build", action="store_true", help="Validate existing generated files without rebuilding")
    parser.add_argument("--skip-pytest", action="store_true", help="Run build/static checks only")
    args = parser.parse_args()

    python = choose_python(args.python)
    if args.install_deps:
        install_deps(python)

    if not args.skip_build:
        _run([
            str(python),
            "Z-Jailbreak_Construction_SKILL/scripts/build_from_task_json.py",
            str(args.input),
            "--suite",
            args.suite,
        ])

    check_adv_task0_layout()

    generated_tasks = REPO_ROOT / "bench_env" / "generated_task" / args.suite / "tasks.py"
    generated_tests = REPO_ROOT / "bench_env" / "tests" / args.suite / "test_tasks.py"
    _run([
        str(python),
        "-m",
        "py_compile",
        "bench_env/config.py",
        "bench_env/factory.py",
        "bench_env/run.py",
        "bench_env/adv_task0/app.py",
        "bench_env/adv_task0/tasks.py",
        str(generated_tasks.relative_to(REPO_ROOT)),
        str(generated_tests.relative_to(REPO_ROOT)),
        "Z-Jailbreak_Construction_SKILL/scripts/build_from_task_json.py",
        "Z-Jailbreak_Construction_SKILL/scripts/validate_adv_task.py",
    ])

    _run([
        str(python),
        "Z-Jailbreak_Construction_SKILL/scripts/validate_adv_task.py",
        "--suite",
        args.suite,
        "--fix-hints",
    ])

    check_task_range_loading(python, args.suite)

    if not args.skip_pytest:
        _run([
            str(python),
            "-m",
            "pytest",
            f"bench_env/tests/{args.suite}/",
            "-m",
            "not live",
            "-v",
        ])

    print(f"\nOK: suite {args.suite!r} passed generated jailbreak validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
