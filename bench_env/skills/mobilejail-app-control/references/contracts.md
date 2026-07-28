# Runtime contracts

## Dispatch order

1. Require `__SIM__`, `__SIM_FS__`, `__OS__`, and `__BENCH_STORES__`. Runner
   preflight may rebuild a broken page before task preparation.
2. Open the app with `env.open_app(app_id, wait_stable=True)`.
3. Capture `env.get_state(required_apps=[app_id])`.
4. Invoke the actual function in the browser.
5. Capture state again.
6. Return `CallResult` with the function result and changed paths.

## Store actions

Call Zustand actions through:

```javascript
window.__BENCH_STORES__.get(appId).getState()[action](...args)
```

The registry is intentionally exposed by `os/createAppStore.ts` in the Vite
development environment used by `MobileGymEnv`. A missing registry is a runtime
configuration error, not a successful no-op.

## Module functions

Provider-backed and OS-backed apps expose important functions outside Zustand.
Load those modules through Vite dynamic import and invoke the named export:

```javascript
const module = await import(modulePath);
await module[functionName](...args);
```

Current semantic wrappers use this path for SMS, Mail, Settings, Contacts,
FileSystem, and Gallery.

Transient Vite module-fetch failures are retried before the exported function
is invoked. Store mutations are not blindly retried because an interrupted
call may already have changed state.

## Planner context

`MobileJail.task_context(app_ids)` emits bounded JSON containing the requested
app stores, relevant provider data, and selected OS/settings/filesystem state.
It preserves both ends of long lists so task-prepared records appended to
defaults remain visible. Large Settings page catalogs and UI dumps are omitted.

## UI-local functions

Some applications keep functionality in React-local state instead of a
registered store action. Invoke their declared `data-action` or `data-trigger`
IDs with `app.ui(action_id)`. This calls the real mounted event handler directly
and does not use screenshot interpretation. Use `app.ui_functions()` to inspect
the IDs available on the current route. Use `app.route(path)` to open a route
declared in `navigation.declaration.ts` before invoking its local function.
Each mounted UI ID is also exposed through its punctuation-normalized Python
name. Use `app.available_functions()` to map Python names back to real store/UI
IDs.

## Function naming

Expose Python snake_case aliases for store camelCase actions. Preserve an
explicit `call("camelCase", ...)` escape hatch. Reject private actions whose
names begin with `_` unless the caller uses `call()` explicitly.

## Results and verification

`CallResult.changed` means the serialized app/OS state differs before and after
the call. `changed_paths` identifies leaf-level differences. A query may
legitimately return `changed=False`; a mutation normally must return
`changed=True`.

Some app actions schedule a delayed commit. Pass `settle_seconds` when invoking
such an action, for example Mail `sendMessage`.

## Adding semantic wrappers

Add a method only when it provides one of these benefits:

- converts a user-facing identifier into a store identifier;
- combines multiple required low-level calls;
- enforces a business precondition such as password or balance validation;
- normalizes a cross-app operation such as sharing.

Keep direct one-to-one actions available through dynamic dispatch instead of
duplicating every store method by hand.
