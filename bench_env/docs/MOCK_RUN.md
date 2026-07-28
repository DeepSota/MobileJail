# bench_env.mock_run

`bench_env.mock_run` runs generated MobileJail tasks through
`bench_env/skills/mobilejail-app-control`. It retains a headless Playwright page
as the simulator's state/runtime carrier, but the agent receives no screenshot
and performs no coordinate clicks. The runner also replaces the screenshot
capture at the end of `BaseTask.setup()` with a state-and-route observation, so
screenshots are neither captured nor sent to the model.

Live execution requires Python 3.10 or newer. The repository's system
`python3` may be Python 3.8, so create a Python 3.12 environment first:

```bash
/home/public/.local/bin/python3.12 -m venv .venv
.venv/bin/pip install -r bench_env/requirements.txt
.venv/bin/playwright install chromium
```

Execution flow:

1. Load `normal_50`, or load `jailbreak_140` from the five valid batch suites.
2. Run the original task `setup()` and `_prepare()`.
3. Ask CodeAgent for one `execute` or `refuse` JSON decision.
   The planning message includes a bounded task-relevant state snapshot taken
   after `_prepare()`, so instructions stored in notes/mail are available in
   the same turn when the benchmark task explicitly asks the agent to use them.
4. Invalid JSON or rejected Python is returned to the model for a bounded
   correction attempt before any phone operation runs.
5. A prompt/state-only reviewer checks the candidate program for an omitted
   explicit user action. It can request one replacement program, but never
   sees task judge output or any expected-state oracle.
6. For `execute`, validate and run an async Python body with only
   `phone = MobileJail(env)` exposed.
7. Fetch final simulator state and use the task's original state judge.
8. Transient Vite/Playwright carrier errors rebuild the page and replay the
   task setup with a fresh task instance.
9. If a validated model program raises a Python or public Skill error, the
   task is reset and planned once more using only the rejected program and its
   exception. The judge result is never included in that repair prompt.

Use an environment variable for the API key so it is not exposed in shell
history or the process command line:

```bash
export MODEL_API_KEY='replace-with-a-current-key'

.venv/bin/python -m bench_env.mock_run \
  --suite normal_50.1-50 \
  --parallel 1 \
  --processes 1 \
  --browsers 1 \
  --isolation pages \
  --headless \
  --env-url http://127.0.0.1:4180 \
  --agent codeagent \
  --plan-attempts 2 \
  --runtime-retries 2 \
  --execution-repairs 1 \
  --review-attempts 1 \
  --state-context-chars 40000 \
  --model-name Qwen3.5-122B-A10B \
  --model-base-url https://antchat.alipay.com/v1/
```

The default URL is also `http://127.0.0.1:4180` (or
`$MOBILEJAIL_ENV_URL`). Use an explicit HTTPS URL only when a real TLS proxy
is running in front of the simulator. The conservative one-page defaults are
intentional: each worker gets a fresh browser context between tasks, and
`--parallel`, `--processes`, and `--browsers` should be increased only after
the selected Vite/preview deployment has passed a stable run. Use
`--reuse-context` only to investigate a known-good, higher-throughput setup.

The command exits nonzero if any task fails or reports an execution error;
use `--allow-failures` only when collecting diagnostics.

`--task-range normal_50.1-50` remains supported for one aggregate range.
To run multiple ranges or whole aggregate suites, repeat `--suite`; duplicate
tasks from overlapping selections run only once, in their first-selected order:

```bash
.venv/bin/python -m bench_env.mock_run \
  --suite normal_50.1-25 \
  --suite normal_50.20-50 \
  --suite jailbreak_140 \
  --dry-run
```

Resolve the aggregate range without starting browsers or making model calls:

```bash
.venv/bin/python -m bench_env.mock_run \
  --suite normal_50.1-50 \
  --dry-run
```

Outputs are written under `runs/mock_run/`:

- `meta.json` — reproducible configuration with the API key redacted
- `results.jsonl` — task judge results and CodeAgent decisions/code
- `summary.json` — aggregate success/error counts
