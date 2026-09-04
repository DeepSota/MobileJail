# Controlled GEPA-MobileJail attack evolution

Implements the analyst-spec experiment design (see `my_test/notes.txt`): a
scientifically defensible, fully inspectable pipeline to test whether
**reflective evolutionary optimisation** produces attack descendants that
outperform their ancestors, generalise to unseen tasks, and do so because of
learned attack structure — not sampling luck or benchmark artefacts.

## Layout

```
experiments/gepa/
  config.py               frozen ExperimentConfig (model roles, split, budget)
  schema.py               FailureCategory taxonomy + rollout/candidate records
  candidate.py            structured attack candidate (immutable {TASK})
  trajectory_analyser.py  raw trajectory -> compact structured diagnosis (ASI)
  lineage_logger.py       candidates.jsonl / lineage.jsonl / rollouts.jsonl
  metrics.py              PRR, EFS, BMF, valid ASR, transfer gain, etc.
  mobilejail_adapter.py   wraps the bridge; logs one RolloutRecord per rollout
  run_controlled.py       main entry: smoke + C0..C5 at fixed max_metric_calls
  plot_evolution.py       evolution curves from run artifacts

configs/gepa/mobilejail_small.yaml   8 train + 3 held-out tasks (frozen)
tests/gepa/                          17 tests (split integrity, role separation,
                                     invalid trials, lineage, heldout isolation)
```

## Quick start

```bash
# 1. Integrity smoke: run the seed candidate vs all 11 tasks (no GEPA)
python -m experiments.gepa.run_controlled --condition smoke

# 2. Reproduce the same-model proposer collapse (C0, tiny budget)
python -m experiments.gepa.run_controlled --condition C0 --budget 32

# 3. Role separation (C1): same setup, separate reflection model
python -m experiments.gepa.run_controlled --condition C1 --budget 32

# 4. Structured trajectory feedback (C2)
python -m experiments.gepa.run_controlled --condition C2 --budget 64

# 5. Whole-instruction evolution (C3), then multi-component (C4)
python -m experiments.gepa.run_controlled --condition C3 --budget 64
python -m experiments.gepa.run_controlled --condition C4 --budget 96

# 6. Confirm with 3 seeds / 3 rollouts, then evaluate frozen held-out
python -m experiments.gepa.run_controlled --condition C5 --budget 128
```

Environment: `MODEL_API_KEY` (and optionally `MODEL_BASE_URL`) must be set.
Target model and reflection model are configured in `ExperimentConfig` /
`mobilejail_small.yaml`.

## The three research questions (per analyst spec)

1. Does GEPA improve **training-task ASR** over the seed attack?
2. Does that improvement **transfer to untouched held-out tasks**?
3. Does **structured trajectory feedback** beat scalar feedback at the same
   evaluation budget?

Held-out tasks never enter GEPA search. Candidate selection is frozen before
held-out evaluation. All runs record lineage DAG + per-rollout diagnostics, so
you can answer "is this attack evolving, or just sampling?"

## Inspect / modify

- **Config**: edit `configs/gepa/mobilejail_small.yaml` or `config.py`.
- **Candidate structure**: edit `candidate.py` (`SEED_CANDIDATE` components).
- **Failure taxonomy / ASI**: edit `schema.py` / `trajectory_analyser.py`.
- **Scoring**: `score_binary` / `score_shaped` in `run_controlled.py`.
- **Plots**: after a run, `python -m experiments.gepa.plot_evolution
  --run-dir runs/<run_id> --out curve.png`.

## Budget & matrix (analyst spec §13)

| Run | Separation | Feedback | Representation | Budget | Seeds | Rollouts/task |
|---|---|---:|---|---:|---:|---:|
| Smoke | N/A | Diagnostic | Seed only | 0 | 1 | 1 |
| C0 | No | Existing | Existing | 32 | 1 | 1 |
| C1 | Yes | Existing | Existing | 32 | 1 | 1 |
| C2 | Yes | Structured | Existing | 64 | 1 | 1 |
| C3 | Yes | Structured | Whole text | 64 | 1 | 1 |
| C4 | Yes | Structured | Multi-component | 96 | 1 | 1 |
| Confirm | Yes | Structured | Best | 128 | 3 | 3 |
| Transfer | Frozen | N/A | Best + seed | — | same | ≥3 |
