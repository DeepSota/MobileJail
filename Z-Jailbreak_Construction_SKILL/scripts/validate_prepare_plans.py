#!/usr/bin/env python3
"""自动校验 jailbreak_140 的统一前置准备契约。

默认执行三层校验：

* source：merged JSON 的 action/app/params schema；
* sync：五个 batch 的 prepare_plan 与源 JSON 逐字面一致，且不存在逐任务 _prepare；
* offline：在内存模拟状态上执行全部计划，验证后置条件、越界写入、
  确定性、重置隔离和“未执行任务动作”的判定基线。

``--live`` 会额外连接真实 MobileGym 模拟器，让 BaseTask.setup 完成真实 reset、
app warm、统一准备和状态回读。可用 ``--task-id`` 限定任务。
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import base64
import copy
import hashlib
import importlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from bench_env.adv_task0.tasks import AdvBaseTask
from bench_env.env.base import Observation
from bench_env.task.judge import JudgeInput
from bench_env.task.jailbreak_check import validate_check_plan
from bench_env.task.preparation import execute_prepare_plan, validate_prepare_plan


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "Z-越狱构建" / "mobilegym_jailbreak_140_merged.json"
BATCH_ROOT = REPO_ROOT / "bench_env" / "generated_task"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> None:
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = copy.deepcopy(value)


def _stable_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _defaults_hash() -> str:
    digest = hashlib.sha256()
    paths = sorted(
        list((REPO_ROOT / "apps").glob("*/data/defaults.json"))
        + list((REPO_ROOT / "system").glob("*/data/defaults.json"))
        + list((REPO_ROOT / "os").glob("**/defaults/*.json"))
        + [REPO_ROOT / "os" / "data" / "defaults.json"]
    )
    for path in paths:
        digest.update(str(path.relative_to(REPO_ROOT)).encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def build_runtime_baseline() -> dict[str, Any]:
    """从真实 defaults 构造执行器所需的最小完整运行时快照。"""
    apps: dict[str, Any] = {}
    for root_name in ("apps", "system"):
        for manifest in (REPO_ROOT / root_name).glob("*/manifest.ts"):
            text = manifest.read_text(encoding="utf-8")
            match = re.search(r"\bid\s*:\s*['\"]([^'\"]+)", text)
            defaults = manifest.parent / "data" / "defaults.json"
            if match and defaults.exists():
                apps[match.group(1)] = _load_json(defaults)

    notes_defaults = apps["notes"]
    apps["notes"] = {
        "notes": notes_defaults.get("sampleNotes", []),
        "todos": notes_defaults.get("sampleTodos", []),
        "folders": [
            {"id": "all", "name": "全部", "system": True},
            {"id": "unfiled", "name": "未分类", "system": True},
        ],
        "selectedFolderId": "all",
        "settings": notes_defaults.get("settings", {}),
    }
    calendar_defaults = apps["calendar"]
    apps["calendar"] = {
        "settings": calendar_defaults.get("settings", {}),
        "events": [],
        "selectedDateTs": 1773619200000,
    }

    os_state = _load_json(REPO_ROOT / "os" / "data" / "defaults.json")
    os_state.update({
        "providers": {
            "contacts": _load_json(REPO_ROOT / "os" / "providers" / "defaults" / "contacts.json"),
            "mail": _load_json(REPO_ROOT / "os" / "providers" / "defaults" / "mail.json"),
            "sms": _load_json(REPO_ROOT / "os" / "providers" / "defaults" / "sms.json"),
        },
        "clipboard": None,
        "fileSystem": {"nodes": []},
        "time": {"iso_date": "2026-03-16"},
        "activeAppId": None,
        "activeTaskId": None,
        "isLauncherVisible": True,
        "runningApps": [],
        "tasks": [],
    })
    return {"apps": apps, "os": os_state}


class _MemoryPage:
    def __init__(self, env: "MemoryPreparationEnv") -> None:
        self.env = env

    async def evaluate(self, script: str, arg: Any) -> None:
        if isinstance(arg, str):
            item = {
                "type": "text",
                "content": arg,
                "timestamp": 1773619200000,
                "source": "task_prep",
            }
            self.env.state["os"]["clipboard"] = item
            return
        if isinstance(arg, dict) and "iso_date" in arg:
            from datetime import datetime

            value = str(arg["iso_date"])
            timestamp = int(datetime.fromisoformat(f"{value}T12:00:00").timestamp() * 1000)
            self.env.state["os"]["time"] = {
                "mode": "simulated",
                "timestamp": timestamp,
                "iso_date": value,
            }
            return
        raw = base64.b64decode(arg["encoded"])
        path = str(arg["path"])
        nodes = self.env.state["os"]["fileSystem"]["nodes"]
        nodes[:] = [node for node in nodes if str(node["path"]) != path]
        nodes.append({
            "id": f"mem_file_{hashlib.sha256(path.encode()).hexdigest()[:16]}",
            "name": path.rsplit("/", 1)[-1],
            "type": "file",
            "parentId": None,
            "path": path,
            "size": len(raw),
            "mimeType": str(arg["mimeType"]),
            "createdAt": 1773619200000,
            "modifiedAt": 1773619200000,
            "storage": "memory",
            "contentText": (
                raw.decode("utf-8")
                if str(arg["mimeType"]).startswith("text/")
                else None
            ),
        })


class MemoryPreparationEnv:
    """只实现统一准备执行器所需接口的确定性内存环境。"""

    def __init__(self, baseline: dict[str, Any]) -> None:
        self.baseline = copy.deepcopy(baseline)
        self.state = copy.deepcopy(baseline)
        self.page = _MemoryPage(self)

    async def reset(self) -> None:
        self.state = copy.deepcopy(self.baseline)

    async def get_state(
        self, *, required_apps: list[str] | None = None,
    ) -> dict[str, Any]:
        if required_apps:
            missing = sorted(set(required_apps) - set(self.state["apps"]))
            if missing:
                raise KeyError(f"missing required app stores: {missing}")
        return copy.deepcopy(self.state)

    async def set_state(
        self, patch: dict[str, Any], *, deep: bool = True, reload: bool = False,
    ) -> None:
        if not deep:
            raise ValueError("preparation validation requires deep merge")
        _deep_merge(self.state, patch)


def load_tasks(input_path: Path) -> list[dict[str, Any]]:
    raw = _load_json(input_path)
    tasks = raw.get("任务列表")
    if not isinstance(tasks, list):
        raise ValueError("input must contain list field 任务列表")
    if len(tasks) != 140:
        raise ValueError(f"expected 140 tasks, got {len(tasks)}")
    return tasks


def validate_source_and_sync(tasks: list[dict[str, Any]]) -> Counter[str]:
    plans: dict[str, list[dict[str, Any]]] = {}
    check_plans: dict[str, dict[str, Any]] = {}
    actions: Counter[str] = Counter()
    for task in tasks:
        task_id = str(task["任务ID"])
        plan = validate_prepare_plan(task["前置准备"], task_id=task_id)
        plans[task_id] = plan
        actions.update(str(step["action"]) for step in plan)
        rule = task.get("规则验证")
        automated = rule.get("自动化规则") if isinstance(rule, dict) else None
        if not isinstance(automated, dict):
            raise ValueError(f"{task_id}: 规则验证.自动化规则 must be an object")
        automated = validate_check_plan(automated, task_id=task_id)
        params = automated["params"]
        if str(automated["check"]).startswith("settings_"):
            paths = params.get("setting_paths")
            values = params.get("breach_values")
            if (
                not isinstance(paths, list)
                or not paths
                or any(not isinstance(path, str) or not path for path in paths)
                or not isinstance(values, list)
                or len(values) != len(paths)
            ):
                raise ValueError(
                    f"{task_id}: settings rule requires non-empty, aligned "
                    "setting_paths/breach_values"
                )
        check_plans[task_id] = copy.deepcopy(automated)

    found: dict[str, list[dict[str, Any]]] = {}
    found_checks: dict[str, dict[str, Any]] = {}
    custom_prepare: list[str] = []
    custom_check: list[str] = []
    for batch_index in range(1, 6):
        path = BATCH_ROOT / f"jailbreak_140_batch{batch_index}" / "tasks.py"
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in tree.body:
            if not isinstance(node, ast.ClassDef) or not node.name.startswith("T"):
                continue
            assignment = next(
                (
                    item
                    for item in node.body
                    if isinstance(item, ast.Assign)
                    and any(
                        isinstance(target, ast.Name) and target.id == "prepare_plan"
                        for target in item.targets
                    )
                ),
                None,
            )
            if assignment is None:
                raise ValueError(f"{path}: {node.name} missing prepare_plan")
            found[node.name] = ast.literal_eval(assignment.value)
            check_assignment = next(
                (
                    item
                    for item in node.body
                    if isinstance(item, ast.Assign)
                    and any(
                        isinstance(target, ast.Name) and target.id == "check_plan"
                        for target in item.targets
                    )
                ),
                None,
            )
            if check_assignment is None:
                raise ValueError(f"{path}: {node.name} missing check_plan")
            found_checks[node.name] = ast.literal_eval(check_assignment.value)
            if any(
                isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                and item.name == "_prepare"
                for item in node.body
            ):
                custom_prepare.append(node.name)
            if any(
                isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                and item.name == "check_goals"
                for item in node.body
            ):
                custom_check.append(node.name)

    if set(found) != set(plans):
        raise ValueError(
            f"batch/source ids differ: missing={sorted(set(plans) - set(found))}, "
            f"extra={sorted(set(found) - set(plans))}"
        )
    mismatched = [task_id for task_id in plans if found[task_id] != plans[task_id]]
    check_mismatched = [
        task_id
        for task_id in check_plans
        if found_checks.get(task_id) != check_plans[task_id]
    ]
    if mismatched or check_mismatched or custom_prepare or custom_check:
        raise ValueError(
            f"batch sync failed: prepare_mismatched={mismatched}, "
            f"check_mismatched={check_mismatched}, custom_prepare={custom_prepare}, "
            f"custom_check={custom_check}"
        )
    return actions


def _task_class(task_id: str) -> type[Any]:
    number = int(task_id[1:5])
    batch_index = min(5, (number - 1) // 30 + 1)
    module = importlib.import_module(
        f"bench_env.generated_task.jailbreak_140_batch{batch_index}.tasks"
    )
    return getattr(module, task_id)


def _judge_input(state: dict[str, Any]) -> JudgeInput:
    init_obs = Observation(screenshot_base64="", route={}, state=state, step_idx=0)
    last_obs = Observation(screenshot_base64="", route={}, state=state, step_idx=1)
    return JudgeInput(init_obs=init_obs, last_obs=last_obs)


async def validate_offline(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    baseline = build_runtime_baseline()
    baseline_hash = _stable_hash(baseline)
    defaults_before = _defaults_hash()
    expected_hashes: dict[str, str] = {}
    step_count = 0
    judge_count = 0
    judge_errors: list[str] = []

    for task_data in tasks:
        task_id = str(task_data["任务ID"])
        env = MemoryPreparationEnv(baseline)
        report = await execute_prepare_plan(
            env,
            task_data["前置准备"],
            task_id=task_id,
            required_apps=[str(app) for app in task_data.get("目标App", [])],
        )
        if not report.success:
            raise AssertionError(f"{task_id}: preparation report is not successful")
        step_count += len(report.steps)
        expected_hashes[task_id] = _stable_hash(env.state)

        task = _task_class(task_id)()
        try:
            judge_input = _judge_input(copy.deepcopy(env.state))
            checks = task.check_goals(judge_input)
            if not checks or any("passed" not in check for check in checks):
                raise AssertionError("invalid unchanged-state check_goals result")
            if isinstance(task, AdvBaseTask):
                if not all(bool(check["passed"]) for check in checks):
                    raise AssertionError(
                        f"unchanged prepared state is incorrectly judged as breached: {checks}"
                    )
            elif task.is_successful(judge_input):
                raise AssertionError(
                    "unchanged prepared state is incorrectly judged successful"
                )
            judge_count += 1
        except Exception as exc:  # noqa: BLE001 - aggregate all broken rules
            judge_errors.append(f"{task_id}: {type(exc).__name__}: {exc}")

    shared_env = MemoryPreparationEnv(baseline)
    for task_data in tasks:
        task_id = str(task_data["任务ID"])
        await shared_env.reset()
        if _stable_hash(shared_env.state) != baseline_hash:
            raise AssertionError(f"{task_id}: reset did not restore baseline")
        await execute_prepare_plan(
            shared_env,
            task_data["前置准备"],
            task_id=task_id,
            required_apps=[str(app) for app in task_data.get("目标App", [])],
        )
        if _stable_hash(shared_env.state) != expected_hashes[task_id]:
            raise AssertionError(
                f"{task_id}: result differs after prior task; cross-task contamination detected"
            )

    defaults_after = _defaults_hash()
    if defaults_before != defaults_after:
        raise AssertionError("defaults.json changed during preparation validation")
    if judge_errors:
        details = "\n  - ".join(judge_errors)
        raise AssertionError(
            f"{len(judge_errors)} unchanged-state judge baseline(s) failed:\n  - {details}"
        )
    return {
        "tasks": len(tasks),
        "steps_per_pass": step_count,
        "execution_passes": 2,
        "judge_baselines": judge_count,
        "reset_isolation": True,
        "defaults_unchanged": True,
    }


async def validate_live(
    tasks: list[dict[str, Any]], *, url: str, task_ids: set[str],
) -> dict[str, Any]:
    from bench_env.env.mobile_gym import MobileGymEnv

    selected = [
        task for task in tasks
        if not task_ids or str(task["任务ID"]) in task_ids
    ]
    unknown = task_ids - {str(task["任务ID"]) for task in selected}
    if unknown:
        raise ValueError(f"unknown --task-id: {sorted(unknown)}")
    env = MobileGymEnv(
        url=url,
        headless=True,
        coord_space="norm_0_1000",
        delay_after_action=0.1,
        verbose=False,
        viewport_size=(360, 800),
        physical_size=(1080, 2400),
        device_scale_factor=3,
    )
    await env.start()
    previous_markers: set[str] = set()
    isolation_pairs = 0
    has_previous = False

    def prep_markers(value: Any) -> set[str]:
        markers: set[str] = set()
        if isinstance(value, dict):
            for item in value.values():
                markers.update(prep_markers(item))
        elif isinstance(value, list):
            for item in value:
                markers.update(prep_markers(item))
        elif isinstance(value, str) and value.startswith("prep_"):
            markers.add(value)
        return markers

    try:
        for task_data in selected:
            task_id = str(task_data["任务ID"])
            task = _task_class(task_id)()
            await task.setup(env)
            report = getattr(task, "prepare_report", None)
            if report is None or not report.success:
                raise AssertionError(f"{task_id}: missing successful live prepare_report")
            state = await env.get_state(required_apps=task.apps or None)
            current_markers = prep_markers(state)
            leaked = previous_markers & current_markers
            if leaked:
                raise AssertionError(
                    f"{task_id}: previous task preparation markers survived reset: "
                    f"{sorted(leaked)}"
                )
            if has_previous:
                isolation_pairs += 1
            previous_markers = current_markers
            has_previous = True
    finally:
        await env.close()
    return {
        "live_tasks": len(selected),
        "live_reset_isolation_pairs": isolation_pairs,
        "url": url,
    }


async def async_main(args: argparse.Namespace) -> int:
    tasks = load_tasks(args.input)
    actions = validate_source_and_sync(tasks)
    result: dict[str, Any] = {
        "source_tasks": len(tasks),
        "source_steps": sum(actions.values()),
        "actions": dict(sorted(actions.items())),
        "batch_sync": True,
        "check_contract_sync": True,
        "custom_prepare_count": 0,
    }
    if not args.static_only:
        result["offline"] = await validate_offline(tasks)
    if args.live:
        result["live"] = await validate_live(
            tasks,
            url=args.sim_url,
            task_ids=set(args.task_id),
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--static-only", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--sim-url", default="http://localhost:3000")
    parser.add_argument("--task-id", action="append", default=[])
    args = parser.parse_args()
    return asyncio.run(async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
