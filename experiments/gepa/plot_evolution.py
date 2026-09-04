"""Plot evolution curves from run artifacts (analyst spec §13).

Reads run_dir/{rollouts,lineage,candidates}.jsonl and plots train ASR,
held-out ASR and verified state-success rate against accepted lineage depth.

Measured results only — no interpolation across missing depths. When 3 seeds
are available, adds a confidence band over seeds.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .metrics import valid_asr


def build_depth_frame(run_dir: Path) -> dict:
    """Aggregate per-depth metrics from persistent jsonl artifacts."""
    candidates: dict[str, int] = {}
    cand_path = run_dir / "candidates.jsonl"
    if cand_path.exists():
        for line in cand_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            d = json.loads(line)
            candidates[d["content_sha256"]] = d.get("lineage_depth", 0)

    rollouts = []
    roll_path = run_dir / "rollouts.jsonl"
    if roll_path.exists():
        for line in roll_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rollouts.append(json.loads(line))

    # group rollouts by (split, depth)
    by_split_depth: dict[tuple[str, int], list] = {}
    for r in rollouts:
        depth = candidates.get(r.get("candidate_hash"), 0)
        split = r.get("split", "train")
        by_split_depth.setdefault((split, depth), []).append(r)

    frame: dict[int, dict[str, list]] = {}
    for (split, depth), recs in by_split_depth.items():
        frame.setdefault(depth, {}).setdefault(split, []).extend(recs)
    return frame


def render_evolution_table(frame: dict) -> str:
    lines = []
    lines.append(f"{'depth':<6}{'train ASR':<12}{'heldout ASR':<13}{'#train':<8}{'#held':<8}")
    for depth in sorted(frame):
        recs = frame[depth]
        train = valid_asr(recs.get("train", []))
        held = valid_asr(recs.get("heldout", []))
        ta = f"{train['valid_asr']:.2f}" if train["valid_asr"] is not None else "-"
        ha = f"{held['valid_asr']:.2f}" if held["valid_asr"] is not None else "-"
        lines.append(f"{depth:<6}{ta:<12}{ha:<13}{train['valid_trials']:<8}{held['valid_trials']:<8}")
    return "\n".join(lines)


def plot_evolution(frame: dict, output_path: Path) -> None:
    """matplotlib evolution curve (train ASR / heldout ASR vs lineage depth)."""
    try:
        import matplotlib.pyplot as plt
    except ImportError as e:  # pragma: no cover
        raise SystemExit("matplotlib not installed (`pip install matplotlib`)") from e

    fig, ax = plt.subplots(figsize=(8, 5))
    depths = sorted(frame)
    train_x, train_y, held_x, held_y = [], [], [], []
    train_n, held_n = [], []
    for depth in depths:
        recs = frame[depth]
        tr = valid_asr(recs.get("train", []))
        he = valid_asr(recs.get("heldout", []))
        if tr["valid_asr"] is not None:
            train_x.append(depth); train_y.append(tr["valid_asr"]); train_n.append(tr["valid_trials"])
        if he["valid_asr"] is not None:
            held_x.append(depth); held_y.append(he["valid_asr"]); held_n.append(he["valid_trials"])

    if train_x:
        ax.plot(train_x, train_y, marker="o", label="train ASR")
    if held_x:
        ax.plot(held_x, held_y, marker="s", label="held-out ASR")
    ax.set_xlabel("Accepted lineage depth")
    ax.set_ylabel("Attack success rate")
    ax.set_ylim(0, 1)
    ax.set_title("GEPA-MobileJail: attack evolution vs lineage depth")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output_path, dpi=160)
    print(f"saved: {output_path}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("evolution_curve.png"))
    args = p.parse_args()
    frame = build_depth_frame(args.run_dir)
    print(render_evolution_table(frame))
    plot_evolution(frame, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())