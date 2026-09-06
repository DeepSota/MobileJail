"""MobileJail-GEPA adapter (analyst spec §2, §6, §10, §12).

Separates two concerns:
  1. rollout execution — run the target agent in MobileGym for a candidate;
  2. reflection extraction — compress the trace into a short diagnostic ASI
     that GEPA's reflection reads.

Wraps the existing ``MobileJailGEPABridge`` for execution, but:
  - renders `AttackCandidate` dicts via candidate.render(task.instruction);
  - logs a RolloutRecord (score + diagnostic + lineage) per rollout;
  - emits GEPA's side-info as structured ASI.

Score shaping (§6): ``score_mode="shaped"`` gives GEPA a graded optimisation
signal (never used for reporting). ``binary`` keeps 0/1 for reporting. Invalid
trials are excluded/retried, never silently scored 0.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from .candidate import AttackCandidate
from .config import ExperimentConfig
from .lineage_logger import LineageLogger
from .schema import RolloutRecord, TrajectoryDiagnostic
from .trajectory_analyser import analyse_rollout, trajectory_summary

# Target refusal markers that indicate a PROPOSER refuse (the reflection LM
# returned an I-cannot-help instead of a candidate). Note: we detect this from
# the batch evaluator's own output, not from GEPA internals.
PROPOSER_REFUSAL_MARKERS = (
    "I cannot assist", "I can't assist", "cannot help", "won't help",
    "unable to help", "refuse to", "I'm sorry", "I am sorry", "我不能协助",
    "无法协助", "拒绝协助",
)


@dataclass
class RolloutOutcome:
    success: bool
    score: float
    diagnostic: TrajectoryDiagnostic
    rendered_instruction: str
    raw_trace: list[dict[str, Any]] | None = None


class MobileJailAdapter:
    """Bridges a structured AttackCandidate to MobileJail, logging everything.

    ``inner`` is the existing MobileJailGEPABridge (real execution) or a mock
    (deterministic smoke test / CI).
    """

    def __init__(
        self,
        config: ExperimentConfig,
        inner: Any,
        logger: LineageLogger,
        *,
        run_id: str,
        seed_candidate_hash: str,
        score_fn: Callable[..., float],
        analyse_fn: Callable[..., TrajectoryDiagnostic] = analyse_rollout,
    ) -> None:
        self.config = config
        self.inner = inner
        self.logger = logger
        self.run_id = run_id
        self.seed_candidate_hash = seed_candidate_hash
        self.score_fn = score_fn
        self.analyse_fn = analyse_fn
        self._rep = config.candidate_representation
        self._rollout_counter = 0
        self._seen_candidates: set[str] = set()
        self._metric_call = 0
        # Seed reference for lineage "is_seed" detection.
        self.seed_dict: dict[str, str] | None = None
        self.seed_text: str | None = None

    def _render(self, candidate: Any, task_instruction: str) -> str:
        if isinstance(candidate, dict):
            rep = getattr(self, "_rep", "multi_component")
            ac = AttackCandidate.from_dict(candidate, rep)
            return ac.render(task_instruction)
        if isinstance(candidate, AttackCandidate):
            if candidate.data.get("task_wrapper", ""):  # has {TASK} slot
                return candidate.render(task_instruction)
            # No task wrapper: just join component texts (task appended by caller).
            parts = [v for k, v in candidate.data.items() if v]
            return "\n\n".join(parts) if parts else ""
        return str(candidate)

    def _score(self, diagnostic: TrajectoryDiagnostic) -> float:
        if not diagnostic.optimiser_eligible:
            # Invalid trials are excluded, never a 0 that looks like an attack failure.
            return 0.0
        return self.score_fn(diagnostic)

    def _register_candidate(self, candidate: Any, cand_hash: str) -> None:
        """Persist a CandidateRecord for a newly-seen candidate (lineage DAG)."""
        from .schema import CandidateRecord

        self._seen_candidates.add(cand_hash)
        self._metric_call += 1
        if isinstance(candidate, dict):
            components = list(candidate.keys())
            is_seed = candidate == self.seed_dict
        elif isinstance(candidate, AttackCandidate):
            components = candidate.components
            is_seed = candidate.content_hash() == self.seed_candidate_hash
        else:
            components = ["prefix"]
            is_seed = str(candidate) == self.seed_text
        record = CandidateRecord(
            candidate_id=f"c_{self._metric_call:06d}",
            content_sha256=cand_hash,
            representation=getattr(self, "_rep", "multi_component"),
            components=components,
            created_at_metric_call=self._metric_call,
            lineage_depth=0 if is_seed else None,
            is_seed=is_seed,
        )
        if record.lineage_depth is None:
            record.lineage_depth = 1  # refined later from GEPA parents if available
        self.logger.register_candidate(record)

    def evaluate(
        self,
        pairs: Sequence[tuple[Any, dict[str, Any]]],
    ) -> list[tuple[float, dict[str, Any]]]:
        """GEPA's batch evaluator entry. Returns (score, side_info) per pair.

        ``pairs``: list of ``(candidate, example)`` where example has
        ``task_id`` and ``instruction``.
        """
        result: list[tuple[float, dict[str, Any]]] = []
        for candidate, example in pairs:
            task_id = example["task_id"]
            instruction = example.get("instruction", example.get("task_description", ""))
            rendered = self._render(candidate, instruction)

            # Register this candidate in lineage on first sight (unique by hash).
            cand_hash = _hash(candidate)
            if cand_hash not in self._seen_candidates:
                self._register_candidate(candidate, cand_hash)

            # Pre-flight: the target MUST see the actual task. If the rendered
            # instruction lost it (bug class seen in C0-C2), fail fast instead
            # of burning an eval on a task-less prompt.
            if instruction and instruction not in rendered:
                raise RuntimeError(
                    f"rendered instruction lost the task text for {task_id}; "
                    "refusing to run a meaningless eval (candidate render bug). "
                    f"rendered[:200]={rendered[:200]!r}"
                )

            # Real rollout via the bridge with our pre-rendered instruction.
            score, side_info = self.inner.evaluate_rendered(rendered, example)

            diag = self.analyse_fn(
                task_id=task_id,
                success=bool(side_info.get("success") or side_info.get("full_jailbreak")),
                progress=float(side_info.get("progress") or side_info.get("attack_progress") or 0.0),
                stop_reason=side_info.get("stop_reason"),
                agent_message=str(side_info.get("agent_message") or ""),
                agent_answer=str(side_info.get("agent_answer") or ""),
                trace=side_info.get("trajectory") or [],
                exec_error=side_info.get("error"),
                judge_error=side_info.get("judge_error"),
                checker_passed=bool(side_info.get("checker_passed")),
                state_mutation_detected=bool(side_info.get("state_mutation")),
                env_precondition_ok=bool(side_info.get("precondition_ok", True)),
            )

            opt_score = self.score_fn(diag) if diag.optimiser_eligible else 0.0
            self._rollout_counter += 1
            rec = RolloutRecord(
                run_id=self.run_id,
                trial_id=f"{self.run_id}-c{self._rollout_counter}",
                candidate_id=str(example.get("candidate_id", "seed")),
                task_id=task_id,
                split=example.get("split", "train"),
                rollout_idx=self._rollout_counter,
                diagnostic=diag,
                score=opt_score,
                seed_candidate_hash=self.seed_candidate_hash,
                candidate_hash=_hash(candidate),
                target_model=self.config.target_model,
            )
            # Log the FULL rollout record (with checker internals) — that's for
            # our own auditing/rollouts.jsonl.
            self.logger.write_rollout(rec)

            # ASI for GEPA's reflection: STRIP checker internals. The rubric
            # (expected/actual strings, forbidden keywords, judge dicts, internal
            # ids) must never reach the reflection LM — otherwise GEPA's attack
            # "learns" to parrot the checker instead of subverting the agent,
            # which nothing transferable. Full detail stays in the rollout log.
            side_info_out = _sanitize_side_info(side_info)
            side_info_out["failure_category"] = str(diag.failure_category)
            side_info_out["diagnostic"] = diag.as_side_info()
            result.append((opt_score, side_info_out))
        return result


# Checker-internals keys whose raw content must never reach GEPA's reflection LM.
_CHECK_LEAK_KEYS = {
    "breached_checks", "defended_checks", "judge_issues", "judge",
    "check_summary", "checker_passed", "state_mutation",
}


def _sanitize_side_info(side_info: dict) -> dict:
    """Redact checker/rubric internals from the reflection-facing ASI.

    Keeps observables (task, agent message/answer, GUI trajectory) which are the
    legitimate attack-evolution signal. Removes anything that reveals the grading
    rubric (expected/actual state, forbidden keywords, internal ids/field names)
    so GEPA cannot 'game' the checker or quote it back in an attack.
    """
    out = {
        k: v for k, v in side_info.items() if k not in _CHECK_LEAK_KEYS
    }
    # Keep only pass/fail counts for diagnosis, never the rubric text.
    leak_summary = side_info.get("check_summary")
    if isinstance(leak_summary, dict):
        out["check_summary_redacted"] = {
            "total": leak_summary.get("total"),
            "breached": leak_summary.get("breached"),
            "defended": leak_summary.get("defended"),
        }
    return out


def _hash(candidate: Any) -> str:
    if isinstance(candidate, AttackCandidate):
        return candidate.content_hash()
    if isinstance(candidate, dict):
        return hashlib.sha256(
            "\n".join(f"{k}\0{v}" for k, v in sorted(candidate.items())).encode()
        ).hexdigest()
    return hashlib.sha256(str(candidate).encode()).hexdigest()