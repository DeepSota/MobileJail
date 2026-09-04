"""Persistent lineage + rollout logging (analyst spec §8, §9).

Writes append-only jsonl files under run_dir:
  candidates.jsonl   — every candidate (id, hash, representation, depth, parents)
  lineage.jsonl      — every parent->child edge (components changed, score delta)
  rollouts.jsonl     — every evaluation record (score + diagnostic)
  summary.json       — final aggregate

Run provenance (manifest.json) is written by config.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .schema import CandidateRecord, RolloutRecord


class LineageLogger:
    def __init__(self, run_dir: Path) -> None:
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self._candidates_f = open(self.run_dir / "candidates.jsonl", "a", encoding="utf-8")
        self._lineage_f = open(self.run_dir / "lineage.jsonl", "a", encoding="utf-8")
        self._rollouts_f = open(self.run_dir / "rollouts.jsonl", "a", encoding="utf-8")
        self.candidates: dict[str, CandidateRecord] = {}
        self.lineage: list[dict[str, Any]] = []
        self.rollouts: list[RolloutRecord] = []

    # --- candidate records ---

    def register_candidate(self, record: CandidateRecord) -> None:
        self.candidates[record.candidate_id] = record
        self._candidates_f.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
        self._candidates_f.flush()

    def register_lineage_edge(self, child_id: str, parent_ids: list[str], *, mutation_id: str,
                              components_changed: list[str], parent_train_score: float | None,
                              child_train_score: float | None, proposal_status: str) -> None:
        edge = {
            "child_id": child_id,
            "parent_ids": parent_ids,
            "mutation_id": mutation_id,
            "components_changed": components_changed,
            "proposal_status": proposal_status,
            "parent_train_score": parent_train_score,
            "child_train_score": child_train_score,
            "score_delta": (child_train_score - parent_train_score)
            if (parent_train_score is not None and child_train_score is not None) else None,
        }
        self.lineage.append(edge)
        self._lineage_f.write(json.dumps(edge, ensure_ascii=False) + "\n")
        self._lineage_f.flush()

    # --- rollout records ---

    def write_rollout(self, record: RolloutRecord) -> None:
        self.rollouts.append(record)
        self._rollouts_f.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
        self._rollouts_f.flush()

    # --- summary / close ---

    def write_summary(self, payload: dict[str, Any]) -> None:
        (self.run_dir / "summary.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def close(self) -> None:
        for f in (self._candidates_f, self._lineage_f, self._rollouts_f):
            try:
                f.close()
            except Exception:
                pass
