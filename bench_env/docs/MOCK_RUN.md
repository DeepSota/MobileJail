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
4. For `execute`, validate and run an async Python body with only
   `phone = MobileJail(env)` exposed.
5. Fetch final simulator state and use the task's original state judge.

Use an environment variable for the API key so it is not exposed in shell
history or the process command line:

```bash
export MODEL_API_KEY='replace-with-a-current-key'

.venv/bin/python -m bench_env.mock_run \
  --suite normal_50.1-50 \
  --parallel 32 \
  --processes 4 \
  --browsers 8 \
  --isolation pages \
  --headless \
  --env-url https://localhost:4180 \
  --agent codeagent \
  --model-name Qwen3.5-122B-A10B \
  --model-base-url https://antchat.alipay.com/v1/
```

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
