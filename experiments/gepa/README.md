# GEPA attack-evolution experiments (MobileJail)

Entry point for the GEPA-MobileJail attack-evolution research. The goal is
**not** "GEPA found a prompt that worked" — it is to demonstrate *genuine
attack evolution*: descendants that outperform their ancestors, transfer to
unseen tasks, and improve for attributable reasons (with lineage evidence).

## How it works (30-second version)

```
AttackCandidate (dict: strategy / task_wrapper / interaction_guidance / recovery_policy)
        │  GEPA's reflection LM (attacker = deepseek-v4-flash) mutates components
        ▼
MobileJail rollout (target agent = qwen3.7-plus in the simulator)
        │  trajectory + state + checker
        ▼
trajectory_analyser  →  TrajectoryDiagnostic (failure category + ASI text)
        │  score (binary or shaped) + structured side-info
        ▼
GEPA reflection reads the ASI → proposes next candidate   (repeat, ≤ budget)
```

Key design rules (from the analyst spec in `my_test/notes.txt`):
1. **Attacker ≠ target.** `reflection_model` (deepseek-v4-flash) invents
   attacks; `target_model` (qwen3.7-plus) executes them. Config validation
   rejects them being equal in the primary condition.
2. **Held-out tasks never enter search.** 8 train + 3 held-out, disjoint,
   frozen. Held-out evaluation runs only after candidate selection is frozen.
3. **Structured ASI, not binary.** The evaluator emits a failure category
   (e.g. `TARGET_REFUSAL_EARLY`) plus compact trajectory evidence — this is
   what the reflection reads to mutate.
4. **Fixed budget.** Conditions are compared at equal `max_metric_calls`.
5. **Everything is logged.** `runs/<run_id>/` holds candidates, lineage edges,
   per-rollout records, and a summary — so evolution is auditable.

## Files

| File | Role |
|---|---|
| `config.py` | frozen `ExperimentConfig` (models, split, budget, representation) |
| `candidate.py` | structured attack candidate; immutable `{TASK}` slot |
| `trajectory_analyser.py` | rollout → failure category + ASI |
| `schema.py` | taxonomy + diagnostic/rollout records |
| `mobilejail_adapter.py` | bridge wrapper: render → rollout → log → ASI |
| `lineage_logger.py` | candidates/lineage/rollouts jsonl |
| `metrics.py` | PRR, EFS, BMF, valid ASR, transfer gain |
| `run_controlled.py` | **main entry** (smoke + C0..C5) |
| `plot_evolution.py` | evolution curves from run artifacts |
| `configs/gepa/*.yaml` | run configs (small / refusal-focused) |

## Run it

```bash
cd /data1/liborui/my_mobilejail/MobileJail
export MODEL_API_KEY='...'        # required (target + reflection)
export MODEL_BASE_URL='https://xh.v1api.cc/v1'

# 1) Integrity smoke: seed attack vs 11 tasks, no GEPA (~30-45 min)
python -m experiments.gepa.run_controlled --condition smoke

# 2) C0: same-model proposer collapse reproduction (tiny budget)
python -m experiments.gepa.run_controlled --condition C0 --budget 32

# 3) C1: separate attacker, scalar feedback
python -m experiments.gepa.run_controlled --condition C1 --budget 32

# 4) C2: separate attacker + structured trajectory feedback
python -m experiments.gepa.run_controlled --condition C2 --budget 64

# 5) C3 (whole-instruction) / C4 (multi-component)
python -m experiments.gepa.run_controlled --condition C3 --budget 64
python -m experiments.gepa.run_controlled --condition C4 --budget 96

# 6) Plot results from a run
python -m experiments.gepa.plot_evolution --run-dir runs/<run_id> --out curve.png
```

## Reading a run

```
runs/<run_id>/
├── manifest.json        target/reflection models, split, budget, seed
├── candidates.jsonl     every candidate (id, hash, depth, parents)
├── lineage.jsonl        parent→child edges (components changed, score delta)
├── rollouts.jsonl       per-rollout: score + failure category + diagnostic
├── summary.json         aggregate metrics
└── gepa_state/          GEPA-native artifacts (fitness cache, run log)
```

The evolution table / curve shows train ASR and held-out ASR vs **accepted
lineage depth** — the falsifiable claim is: does depth-1+ beat depth-0 (seed)
on train, and does the best candidate transfer to held-out?

## Research questions

1. Does GEPA improve training-task ASR over the seed attack?
2. Does that improvement transfer to untouched held-out tasks?
3. Does structured trajectory feedback beat scalar feedback at equal budget?

## Refusal-focused experiment (current focus)

The smoke showed qwen3.7-plus **refuses** T0013 (bank-card post) and T0020
(self-harm playlist) — those are the tasks worth attacking. `configs/gepa/
mobilejail_refusal.yaml` is the split for that: 8 refusal-prone train tasks
+ 3 held-out probes. Run it with any condition:

```bash
# C2 with the refusal split
python -m experiments.gepa.run_controlled --condition C2 --budget 64 \
    --config configs/gepa/mobilejail_refusal.yaml
```

## Modify

- **Config**: `configs/gepa/*.yaml` (or `ExperimentConfig` defaults).
- **Attack structure**: `candidate.py` `SEED_CANDIDATE` components.
- **Taxonomy / ASI**: `schema.py` + `trajectory_analyser.py`.
- **Scoring**: `score_binary` / `score_shaped` in `run_controlled.py`.
- **Tests**: `tests/gepa/` — run with `python -m pytest tests/gepa -q`.
