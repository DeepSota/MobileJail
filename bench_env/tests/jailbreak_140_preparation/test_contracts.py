"""统一前置准备的全量、隔离和失败闭锁测试。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from bench_env.task.preparation import (
    PreparePlanError,
    execute_prepare_plan,
    validate_prepare_plan,
)


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR_PATH = (
    ROOT / "Z-Jailbreak_Construction_SKILL" / "scripts" / "validate_prepare_plans.py"
)
INPUT_PATH = ROOT / "Z-越狱构建" / "mobilegym_jailbreak_140_merged.json"


def _load_validator() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "mobilejail_validate_prepare_plans", VALIDATOR_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR = _load_validator()


def test_source_schema_and_all_five_batches_are_exactly_synchronized() -> None:
    tasks = VALIDATOR.load_tasks(INPUT_PATH)
    actions = VALIDATOR.validate_source_and_sync(tasks)
    assert len(tasks) == 140
    assert sum(actions.values()) == sum(len(task["前置准备"]) for task in tasks)
    assert len(actions) == 18


@pytest.mark.asyncio
async def test_all_plans_are_deterministic_isolated_and_judge_safe_at_baseline() -> None:
    tasks = VALIDATOR.load_tasks(INPUT_PATH)
    expected_steps = sum(len(task["前置准备"]) for task in tasks)
    result = await VALIDATOR.validate_offline(tasks)
    assert result == {
        "tasks": 140,
        "steps_per_pass": expected_steps,
        "execution_passes": 2,
        "judge_baselines": 140,
        "reset_isolation": True,
        "defaults_unchanged": True,
    }


@pytest.mark.parametrize(
    "plan",
    [
        [{"action": "not_registered", "app": "os", "params": {}}],
        [{"action": "clipboard_set", "app": "wechat", "params": {"text": "x"}}],
        [{"action": "clipboard_set", "app": "os", "params": {}}],
        [{"action": "clipboard_set", "app": "os", "params": {"text": "x", "extra": 1}}],
        [{"action": "app_state_patch", "app": "x", "params": {"patch": []}}],
    ],
)
def test_invalid_contracts_fail_closed(plan: list[dict[str, Any]]) -> None:
    with pytest.raises(PreparePlanError):
        validate_prepare_plan(plan, task_id="invalid_contract")


@pytest.mark.asyncio
async def test_postcondition_failure_is_rejected() -> None:
    class NoOpPage:
        async def evaluate(self, script: str, arg: Any) -> None:
            return None

    env = VALIDATOR.MemoryPreparationEnv(VALIDATOR.build_runtime_baseline())
    env.page = NoOpPage()
    plan = [{"action": "clipboard_set", "app": "os", "params": {"text": "must-exist"}}]
    with pytest.raises(PreparePlanError, match="failed"):
        await execute_prepare_plan(env, plan, task_id="postcondition_failure")


@pytest.mark.asyncio
async def test_out_of_scope_mutation_is_rejected() -> None:
    env = VALIDATOR.MemoryPreparationEnv(VALIDATOR.build_runtime_baseline())
    original_page = env.page

    class LeakyPage:
        async def evaluate(self, script: str, arg: Any) -> None:
            await original_page.evaluate(script, arg)
            self.state["apps"]["x"]["settings"]["leaked_by_prepare"] = True

    leaky_page = LeakyPage()
    leaky_page.state = env.state
    env.page = leaky_page
    plan = [{"action": "clipboard_set", "app": "os", "params": {"text": "scoped"}}]
    with pytest.raises(PreparePlanError, match="unexpected_paths"):
        await execute_prepare_plan(env, plan, task_id="out_of_scope_mutation")
