#!/usr/bin/env python3
"""将 canonical 前置准备计划同步到 jailbreak_140_batch1-5。

本脚本只做机械转换：
1. 按任务 ID 读取 merged JSON 中的 action/app/params；
2. 删除任务类内既有的逐任务 ``_prepare``；
3. 写入由 BaseTask 统一执行的 ``prepare_plan`` 类变量；
4. 重新解析并逐项比对，防止漏任务、错位或内容漂移。
"""

from __future__ import annotations

import argparse
import ast
import json
import pprint
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "Z-越狱构建" / "mobilegym_jailbreak_140_merged.json"
DEFAULT_BATCH_ROOT = REPO_ROOT / "bench_env" / "generated_task"


def _render_assignment(plan: list[dict[str, Any]]) -> str:
    rendered = pprint.pformat(plan, width=100, sort_dicts=False)
    rendered = rendered.replace("\n", "\n    ")
    return f"    prepare_plan = {rendered}\n"


def _task_classes(tree: ast.Module) -> dict[str, ast.ClassDef]:
    return {
        node.name: node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name.startswith("T")
    }


def _assignment_node(node: ast.ClassDef, name: str) -> ast.Assign | ast.AnnAssign | None:
    for item in node.body:
        if isinstance(item, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name for target in item.targets
        ):
            return item
        if (
            isinstance(item, ast.AnnAssign)
            and isinstance(item.target, ast.Name)
            and item.target.id == name
        ):
            return item
    return None


def rewrite_batch(path: Path, plans: dict[str, list[dict[str, Any]]]) -> set[str]:
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines(keepends=True)
    tree = ast.parse(source, filename=str(path))
    classes = _task_classes(tree)
    replacements: list[tuple[int, int, str]] = []
    handled: set[str] = set()
    plans_by_number = {task_id.split("_", 1)[0]: task_id for task_id in plans}

    for task_id, node in classes.items():
        canonical_id = plans_by_number.get(task_id.split("_", 1)[0])
        if canonical_id is None:
            continue
        handled.add(canonical_id)
        replacement = _render_assignment(plans[canonical_id])
        if task_id != canonical_id:
            class_line = lines[node.lineno - 1]
            replacements.append(
                (
                    node.lineno - 1,
                    node.lineno,
                    class_line.replace(task_id, canonical_id, 1),
                )
            )
        old_plan = _assignment_node(node, "prepare_plan")
        old_prepare = next(
            (
                item
                for item in node.body
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                and item.name == "_prepare"
            ),
            None,
        )
        target = old_prepare or old_plan
        if target is not None:
            replacements.append((target.lineno - 1, target.end_lineno or target.lineno, replacement))
            continue

        anchor = _assignment_node(node, "expected_changes")
        if anchor is None:
            first_method = next(
                (
                    item
                    for item in node.body
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                ),
                None,
            )
            if first_method is None:
                raise ValueError(f"{path}: {task_id} has no insertion anchor")
            insert_at = first_method.lineno - 1
        else:
            insert_at = anchor.end_lineno or anchor.lineno
        replacements.append((insert_at, insert_at, "\n" + replacement))

    for start, end, replacement in sorted(replacements, reverse=True):
        lines[start:end] = [replacement]

    updated = "".join(lines)
    updated = updated.replace(
        "Follows the normal_50/tasks.py pattern with _prepare() for state injection\n"
        "and check_goals() for judge logic.",
        "Uses declarative prepare_plan data executed and verified by BaseTask.setup;\n"
        "check_goals() remains the task-specific judge logic.",
    )
    path.write_text(updated, encoding="utf-8")
    return handled


def verify_batches(paths: list[Path], plans: dict[str, list[dict[str, Any]]]) -> None:
    found: dict[str, list[dict[str, Any]]] = {}
    custom_prepare: list[str] = []
    for path in paths:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for task_id, node in _task_classes(tree).items():
            if task_id not in plans:
                continue
            assignment = _assignment_node(node, "prepare_plan")
            if assignment is None:
                raise ValueError(f"{path}: {task_id} missing prepare_plan")
            value_node = assignment.value
            found[task_id] = ast.literal_eval(value_node)
            if any(
                isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                and item.name == "_prepare"
                for item in node.body
            ):
                custom_prepare.append(task_id)

    missing = sorted(set(plans) - set(found))
    extra = sorted(set(found) - set(plans))
    mismatched = sorted(task_id for task_id in found if found[task_id] != plans[task_id])
    if missing or extra or mismatched or custom_prepare:
        raise ValueError(
            "verification failed: "
            f"missing={missing}, extra={extra}, mismatched={mismatched}, "
            f"custom_prepare={custom_prepare}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--check", action="store_true", help="只校验，不改写")
    args = parser.parse_args()

    raw = json.loads(args.input.read_text(encoding="utf-8"))
    tasks = raw.get("任务列表")
    if not isinstance(tasks, list):
        raise ValueError("input must contain 任务列表")
    plans = {
        str(task["任务ID"]): task["前置准备"]
        for task in tasks
    }
    if len(plans) != 140:
        raise ValueError(f"expected 140 unique tasks, got {len(plans)}")

    paths = [
        DEFAULT_BATCH_ROOT / f"jailbreak_140_batch{index}" / "tasks.py"
        for index in range(1, 6)
    ]
    if not args.check:
        handled: set[str] = set()
        for path in paths:
            handled.update(rewrite_batch(path, plans))
        if handled != set(plans):
            raise ValueError(
                f"batch task mapping mismatch: missing={sorted(set(plans) - handled)} "
                f"extra={sorted(handled - set(plans))}"
            )
    verify_batches(paths, plans)
    print(f"OK: verified {len(plans)} prepare_plan definitions in {len(paths)} batches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
