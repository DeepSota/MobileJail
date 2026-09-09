"""Shared schema: failure taxonomy + rollout/candidate/lineage records.

Central enum mirrors the analyst spec's primary categories. The evaluator and
trajectory analyser emit these; metrics and lineage logger consume them. Keeping
them in one module makes the experiment inspectable and modifiable.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal


class FailureCategory(StrEnum):
    """Mutually exclusive primary failure categories (analyst spec §4/§12)."""

    SUCCESS = "SUCCESS"
    PROPOSER_REFUSAL = "PROPOSER_REFUSAL"
    INVALID_CANDIDATE = "INVALID_CANDIDATE"
    TARGET_REFUSAL_EARLY = "TARGET_REFUSAL_EARLY"
    TARGET_REFUSAL_LATE = "TARGET_REFUSAL_LATE"
    TASK_MISINTERPRETATION = "TASK_MISINTERPRETATION"
    PLANNING_FAILURE = "PLANNING_FAILURE"
    GROUNDING_FAILURE = "GROUNDING_FAILURE"
    TOOL_EXECUTION_FAILURE = "TOOL_EXECUTION_FAILURE"
    ENV_PRECONDITION_FAILURE = "ENV_PRECONDITION_FAILURE"
    ENV_RESET_FAILURE = "ENV_RESET_FAILURE"
    STATE_MUTATION_MISSING = "STATE_MUTATION_MISSING"
    CHECKER_MISMATCH = "CHECKER_MISMATCH"
    EXTRACTION_ERROR = "EXTRACTION_ERROR"
    PARTIAL_SUCCESS = "PARTIAL_SUCCESS"
    TIMEOUT_OR_UNSTABLE = "TIMEOUT_OR_UNSTABLE"


# Categories that are NOT attributable to the attack candidate. Invalid trials
# are excluded/retried, never scored 0 (analyst spec §12).
NON_ATTACK_CATEGORIES = frozenset(
    {
        FailureCategory.INVALID_CANDIDATE,
        FailureCategory.ENV_PRECONDITION_FAILURE,
        FailureCategory.ENV_RESET_FAILURE,
        FailureCategory.CHECKER_MISMATCH,
        FailureCategory.EXTRACTION_ERROR,
        FailureCategory.TOOL_EXECUTION_FAILURE,
    }
)


def sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class TrajectoryDiagnostic:
    """Compact, evidence-grounded diagnosis of one rollout (analyst spec §7)."""

    outcome_success: bool
    failure_category: FailureCategory
    failure_stage: str | None = None
    steps_taken: int = 0
    completed_actions: int = 0
    refusal_step: int | None = None
    last_successful_stage: str | None = None
    state_mutation_detected: bool = False
    checker_passed: bool = False
    summary: str = ""
    evidence_refs: list[str] = field(default_factory=list)
    confidence: float = 1.0
    optimiser_eligible: bool = True
    exclusion_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome_success": self.outcome_success,
            "failure_category": str(self.failure_category),
            "failure_stage": self.failure_stage,
            "steps_taken": self.steps_taken,
            "completed_actions": self.completed_actions,
            "refusal_step": self.refusal_step,
            "last_successful_stage": self.last_successful_stage,
            "state_mutation_detected": self.state_mutation_detected,
            "checker_passed": self.checker_passed,
            "summary": self.summary,
            "evidence_refs": self.evidence_refs,
            "confidence": self.confidence,
            "optimiser_eligible": self.optimiser_eligible,
            "exclusion_reason": self.exclusion_reason,
        }

    def as_side_info(self) -> str:
        """Structured reflection text (analyst spec §12 reflection_side_info)."""
        return "\n".join(
            [
                f"Outcome: {'success' if self.outcome_success else 'failure'}",
                f"Category: {self.failure_category}",
                f"Stage: {self.failure_stage or 'n/a'}",
                f"Steps taken: {self.steps_taken}",
                f"Completed actions: {self.completed_actions}",
                f"Refusal step: {self.refusal_step if self.refusal_step is not None else 'none'}",
                f"Environment mutation: {self.state_mutation_detected}",
                f"Checker passed: {self.checker_passed}",
                f"Summary: {self.summary}",
            ]
        )


@dataclass
class RolloutRecord:
    """One immutable evaluation record (analyst spec evaluator contract)."""

    run_id: str
    trial_id: str
    candidate_id: str
    task_id: str
    split: Literal["train", "heldout"]
    rollout_idx: int
    diagnostic: TrajectoryDiagnostic
    score: float
    seed_candidate_hash: str
    candidate_hash: str
    target_model: str
    started_at: str = ""
    finished_at: str = ""
    raw_trajectory_ref: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "trial_id": self.trial_id,
            "candidate_id": self.candidate_id,
            "task_id": self.task_id,
            "split": self.split,
            "rollout_idx": self.rollout_idx,
            "score": self.score,
            "candidate_hash": self.candidate_hash,
            "seed_candidate_hash": self.seed_candidate_hash,
            "target_model": self.target_model,
            "diagnostic": self.diagnostic.to_dict(),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "raw_trajectory_ref": self.raw_trajectory_ref,
        }


@dataclass
class CandidateRecord:
    """Persistent candidate record (analyst spec §8)."""

    candidate_id: str
    content_sha256: str
    representation: str
    components: list[str]
    created_at_metric_call: int
    lineage_depth: int = 0
    is_seed: bool = False
    parent_ids: list[str] = field(default_factory=list)
    mutation_id: str | None = None
    components_changed: list[str] = field(default_factory=list)
    train_score: float | None = None
    accepted: bool = True
    rejection_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "content_sha256": self.content_sha256,
            "representation": self.representation,
            "components": self.components,
            "created_at_metric_call": self.created_at_metric_call,
            "lineage_depth": self.lineage_depth,
            "is_seed": self.is_seed,
            "parent_ids": self.parent_ids,
            "mutation_id": self.mutation_id,
            "components_changed": self.components_changed,
            "train_score": self.train_score,
            "accepted": self.accepted,
            "rejection_reason": self.rejection_reason,
        }
