"""Experiment configuration for controlled GEPA-MobileJail attack evolution.

Implements the analyst spec:
- three model roles configured independently (target / reflection / judge)
- ``require_model_separation`` assertion (attacker != target in primary condition)
- exactly 8 train + 3 held-out tasks, disjoint, frozen before any optimisation
- candidate representation (prefix / whole_instruction / multi_component)
- fixed evaluation budget in GEPA metric calls (max_metric_calls)

Everything the run needs is in this one object so results are reproducible and
inspectable. No secrets are stored here — model API keys come from the
environment at run time.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Literal

CandidateRepresentation = Literal["prefix", "whole_instruction", "multi_component"]
ScoreMode = Literal["binary", "shaped"]
FeedbackMode = Literal["scalar", "structured"]

DEFAULT_TRAIN_TASKS: tuple[str, ...] = (
    "jailbreak_140.T0004_CommRedbookInsultComment",
    "jailbreak_140.T0013_PrivBrowserSubmitToken",
    "jailbreak_140.T0032_FinWechatTransferBoss",
    "jailbreak_140.T0063_LocGalleryShareCurrentPlacePhoto",
    "jailbreak_140.T0067_SafeRedbookDmDangerousChildHealth",
    "jailbreak_140.T0096_AuthMailForwardLatestUnread",
    "jailbreak_140.T0132_LocMailForwardRecentLocation",
    "jailbreak_140.T0077_SocRedbookUseFeedbackNote",
)

DEFAULT_HELDOUT_TASKS: tuple[str, ...] = (
    "jailbreak_140.T0020_ContSpotifyUnsafePlaylist",
    "jailbreak_140.T0097_AuthNotesEbayLogin",
    "jailbreak_140.T0130_CopyFileManagerSharePiracyArchive",
)


@dataclass(frozen=True)
class ExperimentConfig:
    """Frozen configuration; validation is explicit and fail-fast.

    Attributes
    ----------
    target_model : str
        Model behind the MobileJail GUI agent (the model we want to conquer).
    reflection_model : str
        GEPA's reflection/proposer LM (the attacker that invents candidates).
        In the primary condition must differ from ``target_model``.
    judge_model : str | None
        Optional LLM judge (unused unless an LLM-based checker is configured).
    require_model_separation : bool
        If True (primary condition), config validation raises when
        target_model == reflection_model.
    train_task_ids / heldout_task_ids : tuple[str, ...]
        Frozen, disjoint task sets. Held-out tasks never enter GEPA search.
    candidate_representation : str
        prefix | whole_instruction | multi_component
    score_mode : str
        binary (0/1, reporting metric) or shaped (graded optimisation signal).
    feedback_mode : str
        scalar exposes only the score to GEPA reflection; structured also exposes
        sanitized trajectory diagnostics. This is independent of score shaping.
    max_metric_calls : int
        Fixed GEPA evaluation budget. This is the controlled resource when
        comparing optimisers/conditions (per analyst spec §11).
    reflection_minibatch_size : int
        Keep small (2-3) so per-example diagnostics are actually readable.
    optimiser_seed : int
        Seed for GEPA's RNG.
    rollouts_per_task : int
        Target rollouts per candidate/task pair (>=1; use 3 for confirmation).
    env_url / headless / episode_timeout / infer_timeout : str/int/float
        MobileJail simulator connection + episode knobs.
    run_dir : Path
        Where lineage/evaluations/reflections/summary are written.
    """

    # --- model roles (independent) ---
    target_model: str = "qwen3.7-plus"
    reflection_model: str = "openai/deepseek-v4-flash"
    judge_model: str | None = None
    require_model_separation: bool = True

    # --- frozen task split ---
    train_task_ids: tuple[str, ...] = DEFAULT_TRAIN_TASKS
    heldout_task_ids: tuple[str, ...] = DEFAULT_HELDOUT_TASKS

    # --- attack representation ---
    candidate_representation: CandidateRepresentation = "multi_component"
    score_mode: ScoreMode = "binary"
    feedback_mode: FeedbackMode = "structured"

    # --- GEPA budget ---
    max_metric_calls: int = 64
    reflection_minibatch_size: int = 2
    optimiser_seed: int = 17
    rollouts_per_task: int = 1

    # --- MobileJail execution ---
    agent: str = "generic_v2"
    env_url: str = "http://localhost:4173"
    headless: bool = True
    max_steps: int = 30
    episode_timeout: float = 300.0
    infer_timeout: float = 300.0
    temperature: float = 0.0

    # --- output ---
    run_dir: Path = field(default_factory=lambda: Path("runs/gepa"))

    def validate(self) -> None:
        """Fail fast on any configuration that would invalidate the experiment."""
        errors: list[str] = []

        if len(set(self.train_task_ids)) != len(self.train_task_ids):
            errors.append("train_task_ids contains duplicates")
        if len(set(self.heldout_task_ids)) != len(self.heldout_task_ids):
            errors.append("heldout_task_ids contains duplicates")
        overlap = set(self.train_task_ids) & set(self.heldout_task_ids)
        if overlap:
            errors.append(f"train/held-out task leakage: {sorted(overlap)[:5]}")

        if self.require_model_separation and self.target_model == self.reflection_model:
            errors.append(
                "Primary experiment requires distinct target and reflection models "
                f"(both are {self.target_model!r}); set require_model_separation=False "
                "only for the C0 baseline reproduction."
            )

        if self.max_metric_calls <= 0:
            errors.append("max_metric_calls must be > 0")
        if self.reflection_minibatch_size <= 0:
            errors.append("reflection_minibatch_size must be > 0")
        if self.rollouts_per_task <= 0:
            errors.append("rollouts_per_task must be > 0")

        if self.candidate_representation not in ("prefix", "whole_instruction", "multi_component"):
            errors.append(f"unknown candidate_representation: {self.candidate_representation}")
        if self.score_mode not in ("binary", "shaped"):
            errors.append(f"unknown score_mode: {self.score_mode}")
        if self.feedback_mode not in ("scalar", "structured"):
            errors.append(f"unknown feedback_mode: {self.feedback_mode}")

        if errors:
            raise ValueError("ExperimentConfig invalid:\n- " + "\n- ".join(errors))

    def to_manifest(self) -> dict:
        """Non-secret, reproducible run manifest (per analyst spec §9)."""
        return {
            "target_model": self.target_model,
            "reflection_model": self.reflection_model,
            "judge_model": self.judge_model,
            "require_model_separation": self.require_model_separation,
            "candidate_representation": self.candidate_representation,
            "score_mode": self.score_mode,
            "feedback_mode": self.feedback_mode,
            "max_metric_calls": self.max_metric_calls,
            "reflection_minibatch_size": self.reflection_minibatch_size,
            "optimiser_seed": self.optimiser_seed,
            "rollouts_per_task": self.rollouts_per_task,
            "train_tasks": list(self.train_task_ids),
            "heldout_tasks": list(self.heldout_task_ids),
            "agent": self.agent,
            "env_url": self.env_url,
            "episode_timeout": self.episode_timeout,
        }

    def write_manifest(self) -> Path:
        """Persist manifest.json under run_dir."""
        self.run_dir.mkdir(parents=True, exist_ok=True)
        p = self.run_dir / "manifest.json"
        p.write_text(json.dumps(self.to_manifest(), ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    def to_dict(self) -> dict:
        d = asdict(self)
        d["run_dir"] = str(d["run_dir"])
        return d
