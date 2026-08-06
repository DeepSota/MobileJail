"""Task selection helpers for generated aggregate suites."""

from __future__ import annotations

import ast
import importlib
import random
import re
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_GENERATED_ROOT = Path(__file__).resolve().parent / "generated_task"

JAILBREAK_SUITE = "jailbreak_140"


@dataclass(frozen=True)
class TaskDescriptor:
    public_suite: str
    source_suite: str
    class_name: str
    ordinal: int

    @property
    def task_id(self) -> str:
        return f"{self.public_suite}.{self.class_name}"


def _read_task_order(suite: str) -> list[str]:
    """Read TASK_ORDER without importing bench_env or the task module."""
    init_path = _GENERATED_ROOT / suite / "__init__.py"
    if not init_path.is_file():
        raise ValueError(f"generated task suite does not exist: {suite}")
    tree = ast.parse(init_path.read_text(encoding="utf-8"), filename=str(init_path))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(
            isinstance(target, ast.Name) and target.id == "TASK_ORDER"
            for target in node.targets
        ):
            continue
        value = ast.literal_eval(node.value)
        if not isinstance(value, list) or not all(
            isinstance(item, str) for item in value
        ):
            raise ValueError(f"{init_path}: TASK_ORDER must be list[str]")
        return value
    raise ValueError(f"{init_path}: TASK_ORDER is missing")


def _ordered_jailbreak_descriptors() -> list[TaskDescriptor]:
    out: list[TaskDescriptor] = []
    ordinal = 0
    for class_name in _read_task_order(JAILBREAK_SUITE):
        ordinal += 1
        out.append(TaskDescriptor("jailbreak_140", JAILBREAK_SUITE, class_name, ordinal))
    if len(out) != 140:
        raise RuntimeError(
            f"expected 140 aggregate jailbreak tasks, found {len(out)}"
        )
    return out


def _ordered_normal_descriptors() -> list[TaskDescriptor]:
    order = _read_task_order("normal_50")
    if len(order) != 50:
        raise RuntimeError(f"expected 50 normal tasks, found {len(order)}")
    return [
        TaskDescriptor("normal_50", "normal_50", class_name, ordinal)
        for ordinal, class_name in enumerate(order, start=1)
    ]


def _parse_indices(range_text: str, total: int) -> list[int]:
    indices: set[int] = set()
    for chunk in str(range_text).split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.isdigit():
            indices.add(int(chunk))
            continue
        match = re.fullmatch(r"(\d*)-(\d*)", chunk)
        if not match or (not match.group(1) and not match.group(2)):
            raise ValueError(f"invalid task range chunk: {chunk!r}")
        start = int(match.group(1) or 1)
        end = int(match.group(2) or total)
        if end < start:
            raise ValueError(f"range end precedes start: {chunk!r}")
        indices.update(range(start, end + 1))

    invalid = sorted(i for i in indices if i < 1 or i > total)
    if invalid:
        raise ValueError(
            f"task indices out of range 1-{total}: {invalid[:10]}"
        )
    return sorted(indices)


def select_suite_descriptors(suite: str) -> list[TaskDescriptor]:
    """Return every descriptor in one supported aggregate suite."""
    if suite == "jailbreak_140":
        return _ordered_jailbreak_descriptors()
    if suite == "normal_50":
        return _ordered_normal_descriptors()
    raise ValueError(
        "bench_env.mock_run supports suites normal_50 and jailbreak_140"
    )


def select_descriptors(spec: str) -> list[TaskDescriptor]:
    """Resolve aggregate ranges without importing generated task modules."""
    suite, dot, range_text = str(spec).partition(".")
    if not dot or not range_text:
        raise ValueError(
            "--task-range must use <suite>.<range>, "
            "for example jailbreak_140.1-40"
        )
    all_descriptors = select_suite_descriptors(suite)
    selected = _parse_indices(range_text, len(all_descriptors))
    return [all_descriptors[index - 1] for index in selected]


def instantiate_task(
    descriptor: TaskDescriptor,
    *,
    sample_seed: int = 0,
) -> Any:
    module = importlib.import_module(
        f"bench_env.generated_task.{descriptor.source_suite}.tasks"
    )
    task_cls = getattr(module, descriptor.class_name)
    # Each process has its own interpreter, so publishing the aggregate suite
    # on the loaded class cannot race with another shard.
    task_cls._suite = descriptor.public_suite
    seed = (
        sample_seed
        ^ zlib.crc32(descriptor.task_id.encode("utf-8"))
    ) & 0xFFFFFFFF
    return task_cls(_seed=random.Random(seed).randrange(2**32))
