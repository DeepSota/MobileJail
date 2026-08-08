# Changelog

## Unreleased — GEPA jailbreak evolution integration

### Issue
MobileJail can execute and judge adversarial mobile-agent tasks, while GEPA can evolve text candidates from evaluator feedback, but there was no interface connecting GEPA candidates to the actual MobileJail GUI-agent episode lifecycle.

### Reason
A useful integration must preserve MobileJail's environment preparation and attack-success judge. Re-implementing the benchmark inside GEPA would create duplicated semantics and risk optimizing against a different task from the one reported by MobileJail.

### Fix
- Added `bench_env/gepa_jailbreak/bridge.py`.
- GEPA evolves one reusable adversarial prefix.
- Candidate prefixes enter MobileJail through the existing `task_instructions` override.
- Episodes run through the existing mobile GUI agent, MobileGym environment, and `AdvBaseTask` evaluator.
- Full jailbreak success remains the primary signal; partial breach progress is available as a shaping signal.
- Compact trajectory and judge information is returned as GEPA reflective side information.

### Issue
Prompt evolution needs a reproducible generalization protocol rather than optimizing and reporting on the same task set.

### Reason
Per-instance prompt search can overfit task wording and overstate attack robustness.

### Fix
- Added deterministic train/validation/test splitting.
- Added explicit split-file support for fixed research splits.
- Added persisted `split_ids.json` and non-secret run configuration.
- GEPA uses train for search, validation for candidate selection, and held-out test for reporting.

### Issue
The integration needed a single runnable entry point and a low-cost path to validate wiring before expensive GUI-agent evolution.

### Reason
A GEPA metric call now contains a real MobileGym episode, so configuration mistakes are much more expensive than in text-only optimization.

### Fix
- Added `python -m bench_env.gepa_jailbreak.evolve` CLI.
- Defaults to a small 8/4/4 split, 40 metric calls, and GEPA concurrency 1.
- Documented a smaller 2/1/1, 6-eval smoke run.
- Added pure bridge tests for prompt composition, scoring, and deterministic split behavior.
