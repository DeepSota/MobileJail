---
name: mobilejail-app-control
description: >-
  Execute and verify MobileJail application operations through one typed Python
  skill covering every third-party app under apps/ and every system app under
  system/. Use when an agent must call real MobileJail store actions, provider
  functions, settings, filesystem, messaging, publishing, sharing, or payment
  operations without driving the screenshot GUI.
---

# MobileJail App Control

Use one `MobileJail` object. Access each application as a separate class-backed
property and each application action as a function:

```python
from mobilejail_apps import MobileJail

phone = MobileJail(env)
await phone.sms.send("张三", "你好", phone="+86 13800138000")
await phone.wechat.send_text("wxid_boss", "项目已完成")
await phone.x.publish("测试帖子")
```

Run code with `bench_env/skills/mobilejail-app-control/scripts` on
`PYTHONPATH`, or import the script by its absolute path.

## Required workflow

1. Instantiate `MobileJail(env)` with a live `MobileGymEnv`.
2. Select the app property matching the requested app.
3. Prefer a named semantic function such as `send`, `publish`, `comment`,
   `set`, `delete`, or `transfer`.
4. Call any other real Zustand action by snake_case or camelCase:
   `await phone.reddit.create_post(...)` and
   `await phone.reddit.createPost(...)` are equivalent.
   Invoke exported non-store functions with
   `await app.module("/module/path.ts", "functionName", ...)`.
5. Inspect the returned `CallResult`. Require `changed=True` for mutating
   operations unless the underlying function intentionally returns without a
   state mutation.
6. Use `await app.functions()` before an unfamiliar operation. It reports the
   live callable actions registered by that app.
7. For UI-local functionality with no store action (for example Weather,
   Calculator, Gallery, or ThemeStore controls), call the declared action ID
   with `await app.ui("action.id")`. Inspect currently mounted IDs with
   `await app.ui_functions()`. Navigate first with `await app.route("/path")`
   when the control is not on the current route. This is deterministic DOM
   dispatch, not visual GUI-agent reasoning. UI IDs are also independent Python
   functions after replacing punctuation with underscores, for example
   `settings.tempUnit.select.celsius` becomes
   `await app.settings_temp_unit_select_celsius()`.
8. Read [references/apps.md](references/apps.md) only when selecting an app or
   looking up its capability source.
9. Read [references/semantic-api.md](references/semantic-api.md) when writing
   CodeAgent operations or resolving user-facing names and cross-app shares.
10. Read [references/contracts.md](references/contracts.md) when adding a new
   semantic function or diagnosing a failed call.

## Hard constraints

- Invoke real store/provider/service functions. Do not use `env.set_state()` to
  pretend that a user operation succeeded.
- Treat `__BENCH_STORES__` absence, missing stores, missing functions, invalid
  arguments, and failed verification as errors.
- Open/warm the target app before dispatching its store actions.
- Capture before/after state for every call.
- Keep task-local preparation in task `_prepare()`; never put preparation data
  into this skill or application defaults.
- Pass stable identifiers expected by the underlying app (`wxid`,
  `conversationId`, `noteId`, file path), not display text, unless the semantic
  wrapper explicitly resolves display text.
- Do not claim complete execution from a returned value alone. Confirm the
  relevant state delta.

## Maintenance

Run the inventory script after adding or changing an app:

```bash
python bench_env/skills/mobilejail-app-control/scripts/build_catalog.py \
  --repo-root . \
  --output bench_env/skills/mobilejail-app-control/references/apps.md
```

Then run:

```bash
python bench_env/skills/mobilejail-app-control/scripts/self_test.py
python /home/public/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  bench_env/skills/mobilejail-app-control
```
