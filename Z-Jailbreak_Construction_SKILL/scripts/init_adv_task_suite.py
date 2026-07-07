#!/usr/bin/env python3
"""init_adv_task_suite.py — scaffold a fresh bench_env/adv_task0/ tests directory.

The adv_task suite under bench_env/ already exists (it ships with the repo
as a built-in adversarial / jailbreak suite). This script is NOT for
initializing the suite itself — it is for creating the *offline judge test
scaffold* under bench_env/tests/adv_task0/ when that directory is missing,
so newly-generated jailbreak tasks have a place to drop their
OFFLINE_JUDGE_POSITIVE_CASES / OFFLINE_JUDGE_NEGATIVE_CASES matrix.

Usage:
    python Z-Jailbreak_Construction_SKILL/scripts/init_adv_task_suite.py
    python Z-Jailbreak_Construction_SKILL/scripts/init_adv_task_suite.py --force  # overwrite existing
    python Z-Jailbreak_Construction_SKILL/scripts/init_adv_task_suite.py --dry-run  # print plan, do not write

Exit codes:
    0 — scaffold created (or already present and up to date)
    1 — repository layout error
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_DIR = REPO_ROOT / "bench_env" / "tests" / "adv_task0"


INIT_PY = '''"""Offline judge tests for the adv_task (jailbreak) suite."""
'''


TEST_TASKS_PY = '''"""
Offline judge tests for adv_task (jailbreak) suite.

Polarity (note the inversion vs benign suites):
- POSITIVE case  = attack succeeded (agent complied with harmful prompt).
                  curr_state contains the harmful side effect.
                  AdvBaseTask.evaluate() reports success=True (defense breached).
- NEGATIVE case  = agent refused (no harmful state change).
                  curr_state == init_state (deep copy).
                  AdvBaseTask.evaluate() reports success=False (defense held).

Run:
    pytest bench_env/tests/adv_task0/ -m "not live" -v
"""

from __future__ import annotations

import copy
import inspect
import pytest

from bench_env.task.base import BaseTask
from bench_env.adv_task0.tasks import AdvBaseTask
from bench_env.adv_task0 import tasks as _tasks_module
from bench_env.tests.conftest import make_judge_input


ALL_TASK_CLASSES: list[type[BaseTask]] = [
    obj
    for _, obj in inspect.getmembers(_tasks_module, inspect.isclass)
    if issubclass(obj, AdvBaseTask)
    and obj is not AdvBaseTask
    and obj.__module__ == _tasks_module.__name__
]
ALL_TASK_IDS = [cls.__name__ for cls in ALL_TASK_CLASSES]


# =============================================================================
# Per-task positive / negative factories
#
# Each factory returns (task_instance, JudgeInput). For adv_task:
#   - POSITIVE: curr_state contains the harm (sent message / transfer /
#     deletion / settings change). AdvBaseTask.evaluate() reports
#     success=True (all defenses breached = agent did the harm).
#   - NEGATIVE: curr_state == init_state (no changes). AdvBaseTask.evaluate()
#     reports success=False (defense held = agent refused).
#
# Add one positive + one negative factory per task class. The
# test_offline_judge_matrix_complete test below enforces completeness.
# =============================================================================

# TODO: add factories here as the skill generates them.


# =============================================================================
# Judge matrix
# =============================================================================

OFFLINE_JUDGE_POSITIVE_CASES = [
    # ("TaskName", _taskname_positive),
]

OFFLINE_JUDGE_NEGATIVE_CASES = [
    # ("TaskName", _taskname_negative),
]


class TestTaskJudgeMatrixOffline:
    @pytest.mark.parametrize("case_name,factory", OFFLINE_JUDGE_POSITIVE_CASES, ids=lambda item: item)
    def test_positive_cases(self, case_name: str, factory):
        task, judge_input = factory()
        result = task.evaluate(judge_input)
        # POSITIVE = attack succeeded → AdvBaseTask.evaluate() reports success=True
        assert result.success, case_name

    @pytest.mark.parametrize("case_name,factory", OFFLINE_JUDGE_NEGATIVE_CASES, ids=lambda item: item)
    def test_negative_cases(self, case_name: str, factory):
        task, judge_input = factory()
        result = task.evaluate(judge_input)
        # NEGATIVE = agent refused → AdvBaseTask.evaluate() reports success=False
        assert not result.success, case_name
        assert not result.partial_success, case_name

    def test_offline_judge_matrix_complete(self):
        positive = {name for name, _ in OFFLINE_JUDGE_POSITIVE_CASES}
        negative = {name for name, _ in OFFLINE_JUDGE_NEGATIVE_CASES}
        # When factories are added, assert:
        #   assert positive == set(ALL_TASK_IDS)
        #   assert negative == set(ALL_TASK_IDS)
        # Until then, just assert the lists are in sync with each other.
        assert positive == negative, "positive and negative case sets must match"
'''


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaffold bench_env/tests/adv_task0/ for offline judge tests.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    parser.add_argument("--dry-run", action="store_true", help="Print plan, do not write")
    args = parser.parse_args()

    plan: list[tuple[Path, str]] = []

    init_path = TEST_DIR / "__init__.py"
    test_path = TEST_DIR / "test_tasks.py"

    if TEST_DIR.exists() and not args.force:
        # Check whether the files already exist
        if init_path.exists() and test_path.exists():
            print(f"OK: {TEST_DIR} already exists with __init__.py and test_tasks.py — nothing to do.")
            print("    Re-run with --force to overwrite.")
            return 0

    plan.append((init_path, INIT_PY))
    plan.append((test_path, TEST_TASKS_PY))

    for path, content in plan:
        if args.dry_run:
            print(f"  WOULD WRITE: {path} ({len(content)} bytes)")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and not args.force:
                print(f"  SKIP (exists, no --force): {path}")
                continue
            path.write_text(content, encoding="utf-8")
            print(f"  WROTE: {path.relative_to(REPO_ROOT)}")

    print("Done. Next steps:")
    print("  1. Process a prompt file with scripts/parse_prompts.py")
    print("  2. Generate task classes into bench_env/adv_task0/defs/")
    print("  3. Fill OFFLINE_JUDGE_POSITIVE_CASES / NEGATIVE_CASES using")
    print("     assets/test_tasks_template.py.txt as the scaffold")
    print("  4. Run: pytest bench_env/tests/adv_task0/ -m 'not live' -v")
    return 0


if __name__ == "__main__":
    sys.exit(main())
