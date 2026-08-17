#!/usr/bin/env python3
"""从 merged JSON 确定性重建 jailbreak_140_batch1-5。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import build_from_task_json as builder
import normalize_check_calls


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "Z-越狱构建" / "mobilegym_jailbreak_140_merged.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument(
        "--skip-normalize",
        action="store_true",
        help="不重新根据中文规则固化自动化规则，仅按现有字段重建",
    )
    args = parser.parse_args()
    if not args.skip_normalize:
        normalize_check_calls.normalize(args.input)

    specs = builder.normalize_task_json(args.input)
    if len(specs) != 140:
        raise ValueError(f"expected 140 tasks, got {len(specs)}")
    written: list[Path] = []
    for index in range(5):
        batch_specs = specs[index * 30:(index + 1) * 30]
        suite = f"jailbreak_140_batch{index + 1}"
        written.extend(builder.write_outputs(batch_specs, suite, args.input, False))

    # write_outputs 会为每个 batch 写一次 cache；最终恢复为完整 140 条 manifest。
    builder.DEFAULT_CACHE.write_text(
        json.dumps(
            [builder.manifest_entry(spec) for spec in specs],
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"OK: rebuilt {len(specs)} tasks into 5 batches; "
        f"prepare_steps={sum(len(spec.prepare_plan or []) for spec in specs)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
