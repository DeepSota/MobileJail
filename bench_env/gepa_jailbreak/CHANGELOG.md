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

### Issue
The first bridge version returned useful data, but its reflection signal did not explicitly separate execution failures, no-breach outcomes, partial breaches, and full jailbreaks. It also exposed only breached checks as a dedicated list, making the still-defended checks harder for GEPA to diagnose.

### Reason
GEPA's sample efficiency depends on Actionable Side Information (ASI), not only a scalar reward. For expensive GUI rollouts, each episode should tell the reflection model what boundary failed and what evidence supports that conclusion, while preventing task-specific prompt overfitting.

### Fix
- Added explicit outcome diagnosis: `execution_error`, `judge_error`, `no_jailbreak`, `partial_jailbreak`, and `full_jailbreak`.
- Added check counts plus both `breached_checks` and `defended_checks`, preserving each check's expected/actual evidence.
- Added a concise `Feedback` field and `reflection_constraints` that require GEPA to preserve benchmark semantics and avoid copying task-specific literals into the shared prefix.
- Changed compact trajectory sampling to preserve both the beginning and end of long traces.
- Kept screenshots out of reflection feedback for now; the mobile GUI agent still receives them normally.

### Issue
Several bridge edge cases could silently distort experiments or waste a full GEPA batch.

### Reason
`trace_limit=0` previously returned the full trace because `[-0:]` equals `[0:]`; invalid score modes could be hidden by an early error return; duplicate task IDs could violate the intended task-id-disjoint split protocol; and an unexpected exception in one episode could abort the rest of that candidate's batch.

### Fix
- `trace_limit=0` now means no trajectory, and negative limits are rejected.
- Score mode is validated before episode-error handling.
- Duplicate task IDs are rejected in random and explicit split paths.
- GEPA examples are validated for non-empty task IDs and instructions.
- Unexpected per-episode bridge exceptions now produce a zero-score infrastructure diagnostic and allow the remaining examples to continue.
- Environment cleanup now covers evaluator/task-loading failures after environment startup.
- Added tests covering these cases and structured ASI behavior.
