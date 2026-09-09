# GEPA × MobileJail Integration State

## Goal

Evolve a reusable jailbreak instruction prefix with GEPA while the evaluated task agent remains MobileJail's existing screenshot-driven mobile GUI agent.

## Architecture

```text
GEPA candidate
  -> prepend to immutable MobileJail task instruction
  -> existing task setup
  -> existing mobile GUI agent
  -> MobileGym simulator
  -> existing AdvBaseTask evaluator
  -> attack score + structured trajectory/judge feedback
  -> GEPA reflection/evolution
```

## Current implementation

- [x] Reuse `RunnerConfig.task_instructions` instead of modifying generated task classes.
- [x] Reuse `factory.create_agent`, `factory.create_env`, `factory.create_evaluator`, and `BaseRunner.run_episode`.
- [x] Use `EpisodeResult.success` for full jailbreak semantics and `progress` for optional shaping.
- [x] Add synchronous GEPA `batch_evaluator` bridge with candidate-level browser reuse.
- [x] Add deterministic train / validation / test splitting.
- [x] Add CLI entry point `python -m bench_env.gepa_jailbreak.evolve`.
- [x] Persist split IDs, non-secret config, seed, best candidate, and GEPA artifacts.
- [x] Add structured ASI: outcome diagnosis, breached/defended checks, expected/actual evidence, compact head+tail trajectory, and anti-overfit reflection constraints.
- [x] Add bridge-level fault isolation so one unexpected episode exception returns a zero-score diagnostic instead of dropping the entire candidate batch.
- [x] Add validation for score mode, trace limit, duplicate task IDs, and malformed GEPA examples.
- [x] Static-compile the modified bridge/tests and run 16 pure bridge tests in an isolated harness.
- [ ] Run repository-native unit tests/CI in a full checkout of this branch.
- [ ] Execute a real end-to-end smoke run against a running MobileGym simulator and configured target/reflection models.
- [ ] Benchmark concurrency >1 before enabling it as a recommended setting.

## Locked design decisions

1. **Optimization variable:** one shared prefix, not task-specific benchmark content.
2. **Task semantics:** original MobileJail task setup and judge remain authoritative.
3. **Primary research metric:** full jailbreak attack success rate (ASR).
4. **Optimization shaping:** default `hybrid = 0.8 * full_success + 0.2 * breach_progress`.
5. **Generalization:** train and validation drive GEPA; test is held out for reporting.
6. **Reflection evidence:** use textual execution/judge evidence first; screenshots remain out of the GEPA reflection context until text/state evidence is shown insufficient.
7. **Anti-overfit constraint:** reflection must improve only the reusable prefix and must not copy task-specific literals into it.
8. **Initial concurrency:** 1 until end-to-end simulator isolation is verified.
9. **Secrets:** API keys come from environment/CLI runtime and are not persisted in run configuration.

## Known limitations / next work

- One real GEPA evaluation is a real GUI-agent episode; budgets that are cheap for text-only GEPA can be expensive here.
- Current reflection side-info is textual; screenshots are intentionally not embedded in GEPA feedback.
- `EpisodeResult` exposes judge expected/actual evidence but not a separately persisted raw initial/final state fixture; add that only if judge-level evidence proves insufficient for failure analysis.
- Candidate groups reuse one browser sequentially; multi-candidate concurrency has not yet been stress-tested.
- A paper-quality run should use fixed, committed train/val/test task-id files rather than relying only on random split sizes.
