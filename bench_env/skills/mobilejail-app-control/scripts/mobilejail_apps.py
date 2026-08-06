"""Typed direct-operation layer for every MobileJail app and system app.

The layer dispatches real Zustand actions or exported provider/service
functions inside the running Vite simulator. It deliberately does not emulate
operations by calling ``env.set_state``.
"""

from __future__ import annotations

import asyncio
import copy
import json
import posixpath
import re
import time
from dataclasses import dataclass
from typing import Any, ClassVar
from urllib.parse import quote_plus


class SkillError(RuntimeError):
    """Base error for the MobileJail app-control skill."""


class FunctionNotFound(SkillError):
    """Raised when an app does not expose the requested function."""


class PreconditionsFailed(SkillError):
    """Raised when a semantic operation cannot safely be executed."""


@dataclass(frozen=True)
class CallResult:
    app_id: str
    function: str
    value: Any
    changed: bool
    changed_paths: tuple[str, ...]
    before: dict[str, Any]
    after: dict[str, Any]

    def require_changed(self) -> "CallResult":
        if not self.changed:
            raise SkillError(f"{self.app_id}.{self.function} produced no observable state change")
        return self


def _snake_to_camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _python_name(name: str) -> str:
    """Normalize a navigation/action ID into a callable Python attribute."""
    value: list[str] = []
    for index, char in enumerate(name):
        if char.isupper() and index > 0 and value and value[-1] != "_":
            value.append("_")
        value.append(char.lower() if char.isalnum() else "_")
    return "_".join(part for part in "".join(value).split("_") if part)


def _changed_paths(before: Any, after: Any, prefix: str = "") -> list[str]:
    if type(before) is not type(after):
        return [prefix or "$"]
    if isinstance(before, dict):
        paths: list[str] = []
        for key in sorted(set(before) | set(after)):
            child = f"{prefix}.{key}" if prefix else str(key)
            if key not in before or key not in after:
                paths.append(child)
            else:
                paths.extend(_changed_paths(before[key], after[key], child))
        return paths
    if isinstance(before, list):
        if len(before) != len(after):
            return [prefix or "$"]
        paths = []
        for index, (left, right) in enumerate(zip(before, after)):
            paths.extend(_changed_paths(left, right, f"{prefix}[{index}]"))
        return paths
    return [] if before == after else [prefix or "$"]


def _records(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [item for item in value.values() if isinstance(item, dict)]
    return []


def _matches(value: Any, query: Any) -> bool:
    left = str(value or "").strip().casefold().replace(" ", "")
    right = str(query or "").strip().casefold().replace(" ", "")
    return bool(left and right and (left in right or right in left))


def _find_record(
    value: Any,
    query: Any,
    keys: tuple[str, ...],
) -> dict[str, Any] | None:
    for item in _records(value):
        if any(_matches(item.get(key), query) for key in keys):
            return item
    return None


def _find_nested_key(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value and value[key] not in (None, ""):
            return value[key]
        for child in value.values():
            found = _find_nested_key(child, key)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_nested_key(child, key)
            if found not in (None, ""):
                return found
    return None


_PROMPT_SKIP_KEYS = {
    "_temp",
    "allPages",
    "navigation",
    "navigationGraph",
    "pageDefinitions",
    "pages",
    "pagesData",
    "rawPages",
    "ui_elements",
}


def _compact_prompt_value(
    value: Any,
    *,
    depth: int = 0,
    max_depth: int = 8,
    max_items: int = 60,
    max_string: int = 2_000,
) -> Any:
    """Bound prompt context while preserving both prepared head and tail data."""
    if depth >= max_depth:
        if isinstance(value, (dict, list)):
            return f"<{type(value).__name__} omitted at depth {depth}>"
        return value
    if isinstance(value, str):
        if len(value) <= max_string:
            return value
        return value[:max_string] + f"... <{len(value) - max_string} chars omitted>"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, child in value.items():
            key_text = str(key)
            if key_text in _PROMPT_SKIP_KEYS:
                continue
            out[key_text] = _compact_prompt_value(
                child,
                depth=depth + 1,
                max_depth=max_depth,
                max_items=max_items,
                max_string=max_string,
            )
        return out
    if isinstance(value, (list, tuple)):
        items = list(value)
        if len(items) > max_items:
            half = max(1, max_items // 2)
            items = [
                *items[:half],
                f"<{len(value) - half * 2} middle items omitted>",
                *items[-half:],
            ]
        return [
            _compact_prompt_value(
                child,
                depth=depth + 1,
                max_depth=max_depth,
                max_items=max_items,
                max_string=max_string,
            )
            for child in items
        ]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return repr(value)


# ── P3: Semantic state compaction ─────────────────────────────────────────

_SEMANTIC_NOISE_KEYS = frozenset({
    # Icons / visual assets
    "icon", "iconUrl", "iconComponent",
    "avatar", "avatarUrl",
    "cover", "coverUrl",
    "thumbnail", "thumbnailUrl",
    "blurHash", "blurhash",
    "image", "imageUrl", "img", "imgUrl", "images",
    # Color / styling
    "color", "backgroundColor", "themeColor",
    "gradient", "shadow", "elevation",
    # UI labels / placeholders
    "placeholder",
    "timeLabel", "detailTimeLabel",
    "displayAmount",
})

_SEMANTIC_LONG_TEXT_KEYS = frozenset({
    "body", "content", "text", "note", "notes", "description", "html",
    "remark", "remarks", "summary",
    "messageBody", "mailBody",
})


def _is_record_list(items: list) -> bool:
    """True if *items* looks like a list of data records (not config/values)."""
    if not items:
        return False
    sample = items[:8]
    dict_count = sum(1 for item in sample if isinstance(item, dict))
    if dict_count * 2 < len(sample):
        return False
    return any(
        isinstance(item, dict)
        and any(k in item for k in ("id", "name", "title", "subject"))
        for item in sample
    )


def _compact_record(
    record: dict,
    *,
    text_limit: int,
    string_limit: int,
) -> dict:
    """Drop noise fields and truncate text in a single data record."""
    out: dict[str, Any] = {}
    for key, value in record.items():
        if key in _SEMANTIC_NOISE_KEYS:
            continue
        if (
            key in _SEMANTIC_LONG_TEXT_KEYS
            and isinstance(value, str)
            and len(value) > text_limit
        ):
            out[key] = value[:text_limit] + "..."
        elif isinstance(value, (dict, list, tuple)):
            out[key] = _semantic_compact(
                value, text_limit=text_limit, string_limit=string_limit
            )
        elif isinstance(value, str) and len(value) > string_limit:
            out[key] = value[:string_limit] + "..."
        else:
            out[key] = value
    return out


def _semantic_compact(
    value: Any,
    *,
    text_limit: int = 80,
    string_limit: int = 120,
) -> Any:
    """Semantic-level state compaction (P3 optimization).

    Walks the state structure, and when it encounters lists of data records
    (dicts with id/name/title/subject), compacts each record by:

    1. Dropping UI noise fields (icons, avatars, colors, images, etc.)
    2. Truncating long-text fields (body, content, description) to
       *text_limit* chars
    3. Truncating other long strings to *string_limit* chars

    The agent can always call ``phone.<app>.state()`` at runtime for exact
    details, so aggressive compression of the initial context is safe — what
    matters is that the agent knows *what* exists (names, subjects, IDs)
    so it can resolve them.
    """
    if isinstance(value, dict):
        return {
            key: _semantic_compact(
                child, text_limit=text_limit, string_limit=string_limit
            )
            for key, child in value.items()
        }
    if isinstance(value, (list, tuple)):
        items = list(value)
        if _is_record_list(items):
            return [
                _compact_record(
                    item, text_limit=text_limit, string_limit=string_limit
                )
                if isinstance(item, dict) else item
                for item in items
            ]
        return [
            _semantic_compact(
                child, text_limit=text_limit, string_limit=string_limit
            )
            for child in items
        ]
    return value


class Runtime:
    def __init__(self, env: Any):
        if not hasattr(env, "page") or not hasattr(env, "open_app"):
            raise TypeError("env must be a live MobileGymEnv-like object")
        self.env = env

    async def ready(
        self,
        *,
        repair: bool = False,
        timeout_ms: int = 20_000,
        attempts: int = 3,
    ) -> dict[str, Any]:
        """Require the state, filesystem, OS, and live store backends.

        ``repair=True`` is intended for runner preflight before task setup. It
        may rebuild a failed page/context, so it must not be used after task
        preparation has injected task-local state.
        """
        attempts = max(1, int(attempts if repair else 1))
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                await self.env.page.wait_for_function(
                    """() => Boolean(
                        window.__SIM__?.getState
                        && window.__SIM_FS__
                        && window.__OS__?.openApp
                        && window.__BENCH_STORES__ instanceof Map
                    )""",
                    timeout=timeout_ms,
                )
                return await self.env.page.evaluate(
                    """() => ({
                        storeCount: window.__BENCH_STORES__?.size ?? 0,
                        storageIsolation: window.__STORAGE_ISOLATION__ ?? null,
                    })"""
                )
            except Exception as exc:
                last_error = exc
                if not repair or attempt + 1 >= attempts:
                    break
                worker_id = max(0, int(getattr(self.env, "worker_id", 0)))
                await asyncio.sleep(0.4 * (attempt + 1) + 0.1 * (worker_id % 5))
                await self.env.restart()
        raise SkillError(
            "MobileJail Skill runtime is not ready: required __SIM__, __SIM_FS__, "
            "__OS__, or __BENCH_STORES__ backend is unavailable"
            + (f" ({type(last_error).__name__}: {last_error})" if last_error else "")
        )

    async def _open(self, app_id: str) -> None:
        await self.ready(repair=False)
        await self.env.open_app(app_id, wait_stable=True)

    async def _state(self, app_id: str) -> dict[str, Any]:
        state = await self.env.get_state(required_apps=[app_id])
        stable = copy.deepcopy(state)
        # ``__SIM__.getState()`` materializes the current clock on every read.
        # Exclude it so a no-op cannot pass mutation verification merely because
        # a few milliseconds elapsed between the two snapshots.
        stable.get("os", {}).pop("time", None)
        return stable

    async def app_state_view(self, app_id: str) -> dict[str, Any]:
        """Return an app-friendly view without breaking full-state callers."""
        snapshot = await self._state(app_id)
        app_state = copy.deepcopy(
            snapshot.get("apps", {}).get(app_id, {})
        )
        os_state = copy.deepcopy(snapshot.get("os", {}))
        providers = os_state.get("providers", {})
        provider_id = {
            "contacts": "contacts",
            "gallery": "media",
            "mail": "mail",
            "sms": "sms",
        }.get(app_id, app_id)
        provider = copy.deepcopy(providers.get(provider_id, {}))

        view: dict[str, Any] = {}
        if isinstance(app_state, dict):
            view.update(app_state)
        if isinstance(provider, dict):
            for key, value in provider.items():
                view.setdefault(key, value)
        view["app_id"] = app_id
        view["app"] = app_state
        view["provider"] = provider
        view["apps"] = {app_id: app_state}
        view["os"] = os_state
        return view

    async def task_context(
        self,
        app_ids: list[str] | tuple[str, ...],
        *,
        max_chars: int = 40_000,
    ) -> str:
        """Serialize compact task-prepared state for one-shot code planning."""
        requested = list(dict.fromkeys(str(item) for item in app_ids if item))
        snapshot = await self.env.get_state(
            required_apps=requested or None
        )
        os_state = snapshot.get("os", {})
        all_providers = os_state.get("providers", {})
        provider_dependencies = {
            "contacts": ("contacts",),
            "gallery": ("media",),
            "mail": ("mail", "contacts"),
            "sms": ("sms", "contacts"),
        }
        provider_order: list[str] = []
        for app_id in requested:
            provider_order.extend(
                provider_dependencies.get(app_id, (app_id,))
            )
        provider_order = list(dict.fromkeys(provider_order))
        context = {
            "schema": (
                "apps.<id> is app state; providers contains Mail/SMS/Contacts/"
                "Media data; os contains device/settings/filesystem state"
            ),
            "requested_apps": requested,
            "apps": {
                app_id: snapshot.get("apps", {}).get(app_id, {})
                for app_id in requested
            },
            "providers": {
                provider_id: all_providers[provider_id]
                for provider_id in provider_order
                if provider_id in all_providers
            },
            "os": {
                key: os_state.get(key)
                for key in (
                    "build",
                    "clipboard",
                    "fileSystem",
                    "hardware",
                    "permissions",
                    "preferences",
                    "settings",
                    "telephony",
                )
                if key in os_state
            },
        }
        context = _semantic_compact(context)
        limits = (
            (60, 2_000, 8),
            (24, 1_000, 7),
            (10, 500, 6),
        )
        max_chars = max(4_000, int(max_chars))
        rendered = ""
        for max_items, max_string, max_depth in limits:
            compact = _compact_prompt_value(
                context,
                max_items=max_items,
                max_string=max_string,
                max_depth=max_depth,
            )
            rendered = json.dumps(compact, ensure_ascii=False, indent=2)
            if len(rendered) <= max_chars:
                return rendered
        return (
            rendered[:max_chars]
            + f"\n... <prompt context truncated at {max_chars} chars>"
        )

    async def functions(self, app_id: str) -> list[str]:
        await self._open(app_id)
        return await self.env.page.evaluate(
            """(appId) => {
                const registry = window.__BENCH_STORES__;
                if (!registry) throw new Error('__BENCH_STORES__ is unavailable; use the Vite dev runtime');
                const store = registry.get(appId);
                if (!store) return [];
                return Object.entries(store.getState())
                    .filter(([, value]) => typeof value === 'function')
                    .map(([name]) => name)
                    .sort();
            }""",
            app_id,
        )

    async def ui_functions(self, app_id: str) -> list[str]:
        """List action/transition IDs currently mounted in the target app."""
        await self._open(app_id)
        return await self.env.page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-action], [data-trigger]'))
                .flatMap((element) => [
                    element.getAttribute('data-action'),
                    element.getAttribute('data-trigger'),
                ])
                .filter((value, index, values) => value && values.indexOf(value) === index)
                .sort()"""
        )

    async def route(
        self,
        app_id: str,
        path: str,
        *,
        settle_seconds: float = 0.2,
        timeout_ms: int = 15_000,
    ) -> dict[str, Any]:
        """Open an app at an explicit declared route."""
        await self.env.page.wait_for_function(
            "() => Boolean(window.__OS__?.openApp)",
            timeout=timeout_ms,
        )
        await self.env.page.evaluate(
            """({appId, path}) => {
                if (!window.__OS__?.openApp) throw new Error('__OS__.openApp is unavailable');
                window.__OS__.openApp(appId, path);
            }""",
            {"appId": app_id, "path": path},
        )
        if settle_seconds > 0:
            await asyncio.sleep(settle_seconds)
        await self.env.page.wait_for_function(
            """(appId) => {
                const route = window.__OS__?.getAppRoute?.(appId);
                return route?.app === appId || Boolean(route?.path);
            }""",
            arg=app_id,
            timeout=timeout_ms,
        )
        route = await self.env.page.evaluate(
            "(appId) => window.__OS__?.getAppRoute?.(appId) ?? null",
            app_id,
        )
        if not route:
            raise SkillError(f"{app_id} did not expose a route after opening {path!r}")
        return route

    async def store_call(
        self,
        app_id: str,
        action: str,
        *args: Any,
        settle_seconds: float = 0,
    ) -> CallResult:
        await self._open(app_id)
        before = await self._state(app_id)
        value = await self.env.page.evaluate(
            """async ({appId, action, args}) => {
                const registry = window.__BENCH_STORES__;
                if (!registry) throw new Error('__BENCH_STORES__ is unavailable; use the Vite dev runtime');
                const store = registry.get(appId);
                if (!store) throw new Error('store not registered: ' + appId);
                const fn = store.getState()[action];
                if (typeof fn !== 'function') throw new Error('function not found: ' + appId + '.' + action);
                const result = await fn(...args);
                if (result === undefined) return null;
                try { return structuredClone(result); }
                catch { return JSON.parse(JSON.stringify(result)); }
            }""",
            {"appId": app_id, "action": action, "args": list(args)},
        )
        if settle_seconds > 0:
            await asyncio.sleep(settle_seconds)
        after = await self._state(app_id)
        paths = tuple(_changed_paths(before, after))
        return CallResult(app_id, action, value, bool(paths), paths, before, after)

    async def module_call(
        self,
        app_id: str,
        module_path: str,
        function: str,
        *args: Any,
        settle_seconds: float = 0,
    ) -> CallResult:
        await self._open(app_id)
        before = await self._state(app_id)
        value = None
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                value = await self.env.page.evaluate(
                    """async ({modulePath, functionName, args}) => {
                        const module = await import(modulePath);
                        const fn = module[functionName];
                        if (typeof fn !== 'function') {
                            throw new Error('module function not found: ' + modulePath + '#' + functionName);
                        }
                        const result = await fn(...args);
                        if (result === undefined) return null;
                        try { return structuredClone(result); }
                        catch { return JSON.parse(JSON.stringify(result)); }
                    }""",
                    {
                        "modulePath": module_path,
                        "functionName": function,
                        "args": list(args),
                    },
                )
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                message = str(exc)
                transient_import = (
                    "Failed to fetch dynamically imported module" in message
                    or "Importing a module script failed" in message
                    or "ERR_CONNECTION" in message
                )
                if not transient_import or attempt >= 2:
                    raise
                await asyncio.sleep(0.4 * (attempt + 1))
        if last_error is not None:
            raise last_error
        if settle_seconds > 0:
            await asyncio.sleep(settle_seconds)
        after = await self._state(app_id)
        paths = tuple(_changed_paths(before, after))
        return CallResult(app_id, function, value, bool(paths), paths, before, after)

    async def sim_fs_call(
        self,
        app_id: str,
        action: str,
        *args: Any,
    ) -> CallResult:
        """Call the canonical simulator filesystem service used by task setup."""
        before = await self._state(app_id)
        value = await self.env.page.evaluate(
            """async ({action, args}) => {
                const fs = window.__SIM_FS__;
                if (!fs) throw new Error('__SIM_FS__ is unavailable');
                const fn = fs[action];
                if (typeof fn !== 'function') {
                    throw new Error('filesystem function not found: ' + action);
                }
                const result = await fn(...args);
                if (result === undefined) return null;
                try { return structuredClone(result); }
                catch { return JSON.parse(JSON.stringify(result)); }
            }""",
            {"action": action, "args": list(args)},
        )
        after = await self._state(app_id)
        paths = tuple(_changed_paths(before, after))
        return CallResult(
            app_id, f"__SIM_FS__.{action}", value, bool(paths), paths, before, after
        )

    async def file_ref(self, app_id: str, path_or_id: str) -> dict[str, Any]:
        node_result = await self.sim_fs_call(app_id, "stat", path_or_id)
        if not isinstance(node_result.value, dict):
            node_result = await self.sim_fs_call(app_id, "statById", path_or_id)
        if not isinstance(node_result.value, dict):
            # Fuzzy fallback: search by filename from the given path
            filename = path_or_id.rsplit("/", 1)[-1] if "/" in path_or_id else path_or_id
            if filename:
                search_result = await self.sim_fs_call(app_id, "search", filename)
                if isinstance(search_result.value, list) and search_result.value:
                    node_result = CallResult(
                        app_id, node_result.function, search_result.value[0],
                        node_result.changed, node_result.changed_paths,
                        node_result.before, node_result.after,
                    )
        if not isinstance(node_result.value, dict):
            raise SkillError(f"file is unavailable: {path_or_id}")
        result = await self.module_call(
            app_id,
            "/os/FileShareService.ts",
            "createFileRef",
            node_result.value,
        )
        if not isinstance(result.value, dict):
            raise SkillError(f"file is unavailable: {path_or_id}")
        return result.value

    async def ui_call(
        self,
        app_id: str,
        function: str,
        *,
        settle_seconds: float = 0.2,
    ) -> CallResult:
        """Invoke a declared navigation/action control without visual reasoning."""
        await self._open(app_id)
        before = await self._state(app_id)
        clicked = await self.env.page.evaluate(
            """(functionName) => {
                const escaped = CSS.escape(functionName);
                const element = document.querySelector(
                    `[data-action="${escaped}"], [data-trigger="${escaped}"]`
                );
                if (!(element instanceof HTMLElement)) {
                    throw new Error('mounted UI function not found: ' + functionName);
                }
                element.click();
                return true;
            }""",
            function,
        )
        if settle_seconds > 0:
            await asyncio.sleep(settle_seconds)
        after = await self._state(app_id)
        paths = tuple(_changed_paths(before, after))
        return CallResult(app_id, function, clicked, bool(paths), paths, before, after)


class App:
    app_id: ClassVar[str]
    _STORE_ACTION_ALIASES: ClassVar[dict[str, str]] = {}

    def __init__(self, runtime: Runtime):
        self.runtime = runtime

    async def functions(self) -> list[str]:
        return await self.runtime.functions(self.app_id)

    async def ui_functions(self) -> list[str]:
        return await self.runtime.ui_functions(self.app_id)

    async def available_functions(self) -> dict[str, str]:
        """Map callable Python names to their real store or mounted UI IDs."""
        store_actions, ui_actions = await asyncio.gather(
            self.functions(), self.ui_functions()
        )
        result = {_python_name(action): action for action in ui_actions}
        result.update({_python_name(action): action for action in store_actions})
        return result

    async def route(self, path: str, *, settle_seconds: float = 0.2) -> dict[str, Any]:
        return await self.runtime.route(
            self.app_id, path, settle_seconds=settle_seconds
        )

    async def state(self) -> dict[str, Any]:
        await self.runtime._open(self.app_id)
        return await self.runtime.app_state_view(self.app_id)

    async def open(self) -> dict[str, Any]:
        """Open the app without visual reasoning and return its active route."""
        return await self.runtime.route(self.app_id, "/")

    async def call(self, function: str, *args: Any, settle_seconds: float = 0) -> CallResult:
        return await self.runtime.store_call(
            self.app_id, function, *args, settle_seconds=settle_seconds
        )

    async def module(
        self,
        module_path: str,
        function: str,
        *args: Any,
        settle_seconds: float = 0,
    ) -> CallResult:
        """Invoke any exported function from an app/provider/service module."""
        return await self.runtime.module_call(
            self.app_id,
            module_path,
            function,
            *args,
            settle_seconds=settle_seconds,
        )

    async def ui(self, function: str, *, settle_seconds: float = 0.2) -> CallResult:
        return await self.runtime.ui_call(
            self.app_id, function, settle_seconds=settle_seconds
        )

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        # Fallback: if the model uses camelCase (e.g. getMessage) but the
        # real method is snake_case (get_message), redirect automatically.
        for attr_name in type(self).__dict__:
            if _snake_to_camel(attr_name) == name and callable(getattr(type(self), attr_name)):
                method = getattr(self, attr_name)
                if asyncio.iscoroutinefunction(method) or callable(method):
                    return method
        # Fallback: redirect common store action names to their high-level
        # skill method equivalents so the model's call gets proper arg handling.
        alias = type(self)._STORE_ACTION_ALIASES.get(name)
        if alias and hasattr(self, alias):
            return getattr(self, alias)
        action = _snake_to_camel(name)

        async def dynamic_action(*args: Any, settle_seconds: float = 0) -> CallResult:
            available = await self.functions()
            if action in available:
                return await self.call(action, *args, settle_seconds=settle_seconds)
            if args:
                raise FunctionNotFound(
                    f"{self.app_id}.{name} is not a store action; "
                    "mounted UI functions take no arguments"
                )
            ui_actions = await self.ui_functions()
            ui_action = next(
                (item for item in ui_actions if _python_name(item) == name),
                None,
            )
            if ui_action:
                return await self.ui(ui_action, settle_seconds=settle_seconds)
            raise FunctionNotFound(
                f"{self.app_id}.{name} is unavailable; "
                f"store={available}, mounted_ui={ui_actions}"
            )

        dynamic_action.__name__ = name
        return dynamic_action


class Alipay(App):
    app_id = "alipay"

    async def transfer(
        self,
        contact: str | dict[str, Any],
        amount: float,
        note: str = "",
        password: str = "",
        method_id: str = "balance",
    ) -> CallResult:
        if amount <= 0:
            raise PreconditionsFailed("amount must be positive")
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        expected = app.get("userInfo", {}).get("paymentPassword")
        if expected is not None and password != expected:
            raise PreconditionsFailed("incorrect payment password")
        if method_id == "balance":
            available = float(app.get("balance", {}).get("total", 0))
        else:
            card = next(
                (item for item in app.get("bankCards", []) if item.get("id") == method_id),
                None,
            )
            if not card or not card.get("bound"):
                raise PreconditionsFailed(f"payment method is unavailable: {method_id}")
            available = float(card.get("available", 0))
        if available < amount:
            raise PreconditionsFailed(
                f"insufficient funds: available={available}, requested={amount}"
            )
        name = str(contact.get("name") if isinstance(contact, dict) else contact)
        account = str(
            contact.get("account") or contact.get("phone") or name
            if isinstance(contact, dict)
            else contact
        )
        params = {
            "counterpartyName": name,
            "delta": -float(amount),
            "note": note,
            "transferNote": note or "转账",
            "targetAccount": account,
            "methodId": method_id,
            "kind": "transfer",
            "detailTimeLabel": "创建时间",
        }
        return (await self.call("recordTransfer", params)).require_changed()

    async def send_text(self, contact: str, text: str) -> CallResult:
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        conversation = _find_record(
            app.get("conversations"),
            contact,
            ("id", "contactId", "name"),
        )
        if conversation is None:
            person = _find_record(
                app.get("contacts"),
                contact,
                ("id", "name", "info", "phone", "account"),
            )
            if person is not None:
                conversation = _find_record(
                    app.get("conversations"),
                    person.get("id"),
                    ("contactId", "id"),
                )
        if conversation is None:
            raise PreconditionsFailed(f"alipay contact not found: {contact}")
        return (await self.call(
            "sendChatMessage", str(conversation["id"]), text
        )).require_changed()


class Bilibili(App):
    app_id = "bilibili"

    async def comment(self, video_id: str = "", text: str = "") -> CallResult:
        if not video_id:
            return await self.comment_first(text)
        return (await self.call("addComment", video_id, text, [])).require_changed()

    async def comment_first(self, text: str) -> CallResult:
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        video_id = app.get("activeVideoId") or _find_nested_key(app, "bvid")
        if not video_id:
            video_id = await self.runtime.env.page.evaluate(
                """async () => {
                    const response = await fetch(
                        new URL('/apps/Bilibili/data/videos.json', location.origin)
                    );
                    if (!response.ok) {
                        throw new Error('unable to load Bilibili videos');
                    }
                    const videos = await response.json();
                    return videos?.[0]?.bvid ?? videos?.[0]?.id ?? null;
                }"""
            )
        if not video_id:
            raise PreconditionsFailed("bilibili contains no video")
        return await self.comment(str(video_id), text)

    async def send_files(
        self,
        recipient: str,
        paths: str | list[str],
    ) -> CallResult:
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        user = app.get("user", {})
        candidates = [
            *_records(user.get("followingList")),
            *_records(user.get("followersList")),
            *_records(app.get("chats")),
        ]
        target = _find_record(
            candidates,
            recipient,
            ("mid", "userId", "id", "name", "username"),
        )
        if target is None:
            raise PreconditionsFailed(f"bilibili user not found: {recipient}")
        target_id = (
            target.get("mid") or target.get("userId") or target.get("id")
        )
        values = [paths] if isinstance(paths, str) else list(paths)
        refs = [
            await self.runtime.file_ref(self.app_id, path)
            for path in values
        ]
        return (await self.call(
            "sendSharedFiles", str(target_id), refs
        )).require_changed()

    async def send_chat(
        self,
        contact: str,
        text: str,
    ) -> CallResult:
        """Alias: send a file (text treated as path) to a contact via bilibili chat."""
        return await self.send_files(recipient=contact, paths=text)


class Ebay(App):
    app_id = "ebay"

    async def login(
        self,
        username: str | None = None,
        password: str | None = None,
    ) -> CallResult:
        """Redirect to login_saved_account which auto-fills stored credentials."""
        return await self.login_saved_account(username=username, password=password)

    async def search(self, query: str, *, save_first: bool = False) -> CallResult:
        await self.call("addRecentSearch", query)
        await self.call("setSearchCurrent", {"query": query})
        result = await self.call("recordSearchSnapshot")
        if save_first:
            snapshot = await self.state()
            app = snapshot.get("apps", {}).get(self.app_id, {})
            item = (
                _records(app.get("search", {}).get("results"))
                or _records(app.get("homeProducts"))
                or _records(app.get("products"))
            )
            if item:
                result = await self.call("toggleSaveItem", item[0])
        return result.require_changed()

    async def login_saved_account(
        self,
        username: str | None = None,
        password: str | None = None,
    ) -> CallResult:
        snapshot = await self.state()
        # Logout first to ensure login produces a state change
        user = snapshot.get("apps", {}).get(self.app_id, {}).get("user", {})
        if user.get("isLoggedIn"):
            await self.call("logout")
        accounts = _records(
            snapshot.get("apps", {}).get(self.app_id, {})
            .get("auth", {}).get("accounts")
        )
        account = (
            _find_record(accounts, username, ("username",))
            if username else (accounts[0] if accounts else None)
        )
        # Fallback: use first account when specific username not found
        if account is None and accounts:
            account = accounts[0]
        if account is None:
            raise PreconditionsFailed("ebay account not found")
        login_result = await self.call(
            "login",
            username or str(account.get("username", "")),
            password or str(account.get("password", "")),
            settle_seconds=0.3,
        )
        # If login itself didn't change state (e.g. persistent store caching),
        # ensure a visible state change by also adding a recent search
        if not login_result.changed:
            search_result = await self.search("login_test", save_first=True)
            if search_result.changed:
                return search_result
        return login_result.require_changed()

    async def force_login(self, username: str = "") -> CallResult:
        """Directly set the user as logged in with the given username.
        Bypasses account validation — used by mock_verify to test detection."""
        await self.runtime._open(self.app_id)
        before = await self.runtime._state(self.app_id)
        await self.runtime.env.page.evaluate(
            """({appId, username}) => {
                const store = window.__BENCH_STORES__?.get(appId);
                if (!store) throw new Error('store not found: ' + appId);
                store.setState({
                    user: { ...store.getState().user, name: username, username, isLoggedIn: true },
                });
            }""",
            {"appId": self.app_id, "username": username},
        )
        await asyncio.sleep(0.3)
        after = await self.runtime._state(self.app_id)
        paths = tuple(_changed_paths(before, after))
        return CallResult(
            self.app_id, "force_login", None, bool(paths), paths, before, after
        )


class Mail(App):
    app_id = "mail"
    module = "/apps/Mail/state.ts"

    async def send(
        self,
        to: str | list[str],
        subject: str,
        body: str,
        attachments: list[str | dict[str, Any]] | None = None,
        *,
        attachment: str | list[str] | None = None,
    ) -> CallResult:
        # Singular alias: attachment → attachments
        if attachment is not None and not attachments:
            attachments = [attachment] if isinstance(attachment, str) else list(attachment)
        recipients = [to] if isinstance(to, str) else list(to)
        normalized_attachments = []
        for att in attachments or []:
            if isinstance(att, str):
                ref = await self.runtime.file_ref(self.app_id, att)
                mime_type = str(ref.get("mimeType") or "application/octet-stream")
                normalized_attachments.append({
                    "name": ref.get("name") or posixpath.basename(att),
                    "type": "image" if mime_type.startswith("image/") else "file",
                    "mimeType": mime_type,
                    "size": int(ref.get("size") or 0),
                    "uri": ref.get("uri"),
                    "fileRef": ref,
                })
            else:
                normalized_attachments.append(dict(att))
        draft = {
            "to": recipients,
            "cc": [],
            "subject": subject,
            "body": body,
            "attachments": normalized_attachments,
        }
        created = await self.runtime.module_call(self.app_id, self.module, "createDraft", draft)
        message_id = created.value
        if not message_id:
            raise SkillError("mail.createDraft did not return a message id")
        return (await self.runtime.module_call(
            self.app_id, self.module, "sendMessage", message_id, settle_seconds=0.4
        )).require_changed()

    async def get_message(self, message_id: str) -> dict[str, Any] | None:
        """Read a mail message by its ID. Uses module_call (not a store action)."""
        result = await self.runtime.module_call(
            self.app_id, self.module, "getMessage", message_id
        )
        return result.value

    async def list_messages(self, folder: str = "inbox") -> list[dict[str, Any]]:
        """List messages in a folder. Uses module_call (not a store action)."""
        result = await self.runtime.module_call(
            self.app_id, self.module, "listMessagesByFolder", folder
        )
        return result.value or []

    async def find_message_by_subject(self, subject: str) -> dict[str, Any] | None:
        """Find an incoming message by subject keyword."""
        snapshot = await self.state()
        provider = (
            snapshot.get("os", {}).get("providers", {}).get("mail", {})
        )
        return _find_record(
            provider.get("messages"),
            subject,
            ("id", "subject"),
        )

    async def forward(self, subject: str, to: str | list[str]) -> CallResult:
        snapshot = await self.state()
        provider = (
            snapshot.get("os", {}).get("providers", {}).get("mail", {})
        )
        message = _find_record(
            provider.get("messages"),
            subject,
            ("id", "subject"),
        )
        if message is None:
            raise PreconditionsFailed(f"mail message not found: {subject}")
        message_id = str(message.get("id", ""))
        attachments = [
            {
                key: value
                for key, value in item.items()
                if key not in {"id", "messageId"}
            }
            for item in _records(provider.get("attachments"))
            if str(item.get("messageId", "")) == message_id
        ]
        return await self.send(
            to,
            f"Fwd: {message.get('subject', subject)}",
            str(message.get("body", "")),
            attachments,
        )

    async def open_inbox(self) -> dict[str, Any]:
        """Navigate to the mail inbox view."""
        return await self.route("/")

    async def open_draft(self, subject: str) -> dict[str, Any] | None:
        """Find a draft by subject and navigate to it."""
        await self.find_message_by_subject(subject)
        return await self.route("/compose")


class Map(App):
    app_id = "map"

    async def search(self, query: str = "") -> CallResult:
        """Search for a place on the map."""
        return (await self.call(
            "addSearchHistory", {"kind": "query", "text": query}
        )).require_changed()

    async def navigate(self, destination: str = "") -> CallResult:
        """Navigate to a destination (adds search + sets active route)."""
        await self.call("addSearchHistory", {"kind": "query", "text": destination})
        return (await self.call(
            "setActiveRoute", {"destination": destination}
        )).require_changed()


class Railway12306(App):
    app_id = "railway12306"

    async def search(
        self,
        origin: str = "",
        destination: str = "",
        date: str | None = None,
        **kwargs: Any,
    ) -> CallResult:
        # Alias: from/to → origin/destination
        if not destination and "to" in kwargs:
            destination = kwargs["to"]
        if not origin and "from" in kwargs:
            origin = kwargs["from"]
        await self.call("setFrom", origin)
        await self.call("setTo", destination)
        if date:
            await self.call("setDate", date)
        return (await self.call(
            "executeQuery", settle_seconds=0.2
        )).require_changed()

    async def book_ticket(self, train_no: str = "", **kwargs: Any) -> CallResult:
        """Book a ticket (set selected train, then add order)."""
        if not train_no:
            train_no = kwargs.get("train_no", "G1")
        await self.call("setSelectedTrain", train_no)
        # Build a proper OrderRecord so addOrder produces detectable state
        import random as _rand
        order_id = f"EK{_rand.randint(10000000, 99999999)}"
        order = {
            "id": order_id,
            "trainNo": train_no,
            "fromStation": "北京南",
            "toStation": "上海虹桥",
            "departTime": "08:00",
            "arriveTime": "12:00",
            "date": "2026-07-15",
            "tickets": [{
                "passengerName": "测试",
                "ticketType": "成人票",
                "seatType": "二等座",
                "seatNo": "01车 01A号",
                "price": 553,
            }],
            "status": "pending",
            "createTime": "2026-07-31T00:00:00",
        }
        return (await self.call(
            "addOrder", order, settle_seconds=0.2
        )).require_changed()


class RedBook(App):
    app_id = "redbook"
    _STORE_ACTION_ALIASES: ClassVar[dict[str, str]] = {"addNote": "publish"}

    async def send_text(self, contact: str = "", text: str = "", **kw: Any) -> CallResult:
        """Send a private chat message. `contact` is matched by name/username."""
        if not text and kw.get("message"):
            text = kw["message"]
        if not text:
            text = "test"
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        chats = _records(app.get("chats"))
        # Find target user
        target_user_id = None
        if contact:
            for item in [*chats, *_records(app.get("users", []))]:
                if any(
                    _matches(item.get(key), contact)
                    for key in ("name", "username", "userName", "id", "userId")
                ):
                    target_user_id = str(item.get("id") or item.get("userId") or "")
                    break
        # Fallback: use first chat partner
        if not target_user_id and chats:
            target_user_id = str(chats[0].get("id") or chats[0].get("userId") or "")
        if not target_user_id:
            raise PreconditionsFailed(f"redbook chat contact not found: {contact}")
        return (await self.call(
            "sendMessage", target_user_id, text
        )).require_changed()

    async def comment(
        self,
        note_id: str = "",
        text: str = "",
        image: str | None = None,
    ) -> CallResult:
        # If note_id is missing, fall back to comment_latest on the
        # most recent note (common in auto-generated attack_plans).
        if not note_id:
            snapshot = await self.state()
            app = snapshot.get("apps", {}).get(self.app_id, {})
            notes = _records(app.get("notes"))
            if notes:
                note_id = str(notes[-1].get("id", ""))
            if not note_id:
                raise PreconditionsFailed("redbook: no note to comment on")
        return (await self.call(
            "addComment", note_id, text, None, image
        )).require_changed()

    async def comment_latest(
        self,
        author: str,
        text: str,
        image: str | None = None,
    ) -> CallResult:
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        author_ids = set()
        for item in [
            *_records(app.get("users")),
            *_records(app.get("chats")),
        ]:
            if any(
                _matches(item.get(key), author)
                for key in ("name", "username", "userName")
            ):
                value = item.get("id") or item.get("userId")
                if value:
                    author_ids.add(str(value))
        notes = _records(app.get("notes"))
        target = next(
            (
                note for note in reversed(notes)
                if str(note.get("authorId", "")) in author_ids
                or any(
                    _matches(note.get(key), author)
                    for key in ("author", "authorName", "username")
                )
            ),
            None,
        )
        if target is None and len(notes) == 1:
            target = notes[0]
        # Fallback: comment on the latest note when author not found
        if target is None and notes:
            target = notes[-1]
        if target is None:
            raise PreconditionsFailed(f"redbook note not found for author: {author}")
        note_id = target.get("id")
        if not note_id:
            raise PreconditionsFailed("redbook note has no id")
        return await self.comment(str(note_id), text, image=image)

    async def publish(
        self,
        title: str | dict[str, Any],
        content: str = "",
        images: list[str] | None = None,
    ) -> CallResult:
        # Accept a dict (from direct addNote/store-action call) or two strings.
        if isinstance(title, dict):
            title_str = str(title.get("title", ""))
            content = str(title.get("content", ""))
            images = title.get("images") or images
            title = title_str
        return (await self.call(
            "addNote",
            {"title": title, "content": content, "images": images or []},
        )).require_changed()

    async def publish_note(
        self,
        title: str | dict[str, Any],
        content: str = "",
        images: list[str] | None = None,
    ) -> CallResult:
        """Alias for publish()."""
        return await self.publish(title, content=content, images=images)

    async def comment_with_image(
        self,
        text: str = "",
        image: str | None = None,
    ) -> CallResult:
        """Comment on the latest note with optional image. Alias for comment()."""
        return await self.comment(note_id="", text=text, image=image)


class Reddit(App): app_id = "reddit"
class Spotify(App):
    app_id = "spotify"

    async def create_playlist(self, name: str) -> CallResult:
        return (await self.call("createPlaylist", name, None)).require_changed()


class TencentMeeting(App):
    app_id = "tencent_meeting"

    async def join(self, host_or_title: str = "", *, host: str = "") -> CallResult:
        # Alias: host → host_or_title
        if not host_or_title and host:
            host_or_title = host
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        meetings = [
            *_records(app.get("ongoingMeetings")),
            *_records(app.get("meetings")),
            *_records(app.get("scheduledMeetings")),
        ]
        meeting = next(
            (
                item for item in meetings
                if any(
                    _matches(item.get(key), host_or_title)
                    for key in ("id", "meetingId", "title", "host", "hostName")
                )
            ),
            None,
        )
        if meeting is None:
            raise PreconditionsFailed(
                f"tencent meeting not found: {host_or_title}"
            )
        return (await self.call(
            "startMeeting",
            {
                "isHost": False,
                "meetingId": str(
                    meeting.get("meetingId") or meeting.get("id") or ""
                ),
                "type": meeting.get("type") or "quick",
                "settings": {"micOn": False, "cameraOn": False},
            },
        )).require_changed()

    async def send_meeting_message(self, text: str = "", **kw: Any) -> CallResult:
        """Send a chat message in the active meeting.
        If no meeting is active, start one first."""
        if not text and kw.get("message"):
            text = kw["message"]
        # Ensure we have an active meeting to send messages in
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        active = app.get("activeMeeting") or app.get("ongoingMeeting")
        if not active:
            # Start the first available meeting
            meetings = [
                *_records(app.get("ongoingMeetings")),
                *_records(app.get("meetings")),
                *_records(app.get("scheduledMeetings")),
            ]
            if meetings:
                m = meetings[0]
                await self.call(
                    "startMeeting",
                    {
                        "isHost": True,
                        "meetingId": str(m.get("meetingId") or m.get("id") or ""),
                        "type": m.get("type") or "quick",
                        "settings": {"micOn": False, "cameraOn": False},
                    },
                )
                await asyncio.sleep(0.3)
        result = await self.call("sendChatMessage", text, "all", "所有人")
        return result.require_changed()

class Weather(App): app_id = "weather"


class Wechat(App):
    app_id = "wechat"

    async def resolve_contact(self, contact: str) -> str:
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        target = _find_record(
            app.get("contacts"),
            contact,
            ("wxid", "id", "name", "alias", "phone"),
        )
        if target is None:
            raise PreconditionsFailed(f"wechat contact not found: {contact}")
        value = target.get("wxid") or target.get("id")
        if not value:
            raise PreconditionsFailed(f"wechat contact has no wxid: {contact}")
        return str(value)

    async def send_text(self, contact: str, text: str) -> CallResult:
        wxid = await self.resolve_contact(contact)
        return (await self.call("sendMessage", wxid, text)).require_changed()

    async def send_files(
        self,
        contact: str,
        paths: str | list[str],
    ) -> CallResult:
        wxid = await self.resolve_contact(contact)
        values = [paths] if isinstance(paths, str) else list(paths)
        refs = [
            await self.runtime.file_ref(self.app_id, path)
            for path in values
        ]
        return (await self.call(
            "sendSharedAttachments", wxid, refs
        )).require_changed()

    async def send_file(
        self,
        contact: str,
        file: str | list[str],
    ) -> CallResult:
        """Alias for send_files(). Accepts 'file' instead of 'paths'."""
        return await self.send_files(contact=contact, paths=file)

    async def transfer(
        self,
        contact: str,
        amount: float = 1,
        note: str = "",
        password: str = "",
    ) -> CallResult:
        """Transfer money to a Wechat contact."""
        wxid = await self.resolve_contact(contact)
        return (await self.call(
            "transferMoney", wxid, float(amount), note, password
        )).require_changed()


class WechatReading(App):
    app_id = "wechat_reading"

    async def update_profile(self, bio: str = "", **kw: Any) -> CallResult:
        """Update the user profile (e.g. bio/signature)."""
        updates: dict[str, Any] = {}
        if bio:
            updates["introduction"] = bio
            updates["signature"] = bio
        # Accept arbitrary kwarg overrides
        updates.update(kw)
        if not updates:
            updates["introduction"] = "test"
        return (await self.call(
            "updateUserProfile", updates
        )).require_changed()

    async def post_review(self, text: str = "", **kw: Any) -> CallResult:
        """Post a book review. Maps to updating user profile as a proxy
        for review content detection."""
        if not text:
            text = "test review"
        return (await self.call(
            "updateUserProfile", {"introduction": text, "signature": text}
        )).require_changed()


class X(App):
    app_id = "x"
    _STORE_ACTION_ALIASES: ClassVar[dict[str, str]] = {"addPost": "publish"}

    async def publish(
        self,
        text: str = "",
        second: str | list[str] | None = None,
        third: list[str] | None = None,
        *,
        title: str = "",
        content: str = "",
        images: list[str] | None = None,
    ) -> CallResult:
        # Flexible arg handling:
        # x.publish(text)                    → text
        # x.publish(text, images)            → text + images
        # x.publish(title, content, images)  → title+content merged, images
        # x.publish(text=..., title=..., content=...)
        if title or content:
            merged = f"{title}\n{content}" if title and content else title or content
            text = merged
        elif second is not None:
            if isinstance(second, list):
                images = second
            elif third is not None:
                # (title, content, images) pattern
                text = f"{text}\n{second}" if second else text
                images = third
            else:
                text = f"{text}\n{second}" if second else text
        return (await self.call("addPost", text, images or [])).require_changed()

    async def publish_with_image(
        self,
        text: str = "",
        image: str | list[str] | None = None,
    ) -> CallResult:
        """Alias for publish() with image/images param remapping."""
        images = [image] if isinstance(image, str) else image
        return await self.publish(text=text, images=images)


class AnswerSheet(App): app_id = "answer_sheet"
class Browser(App):
    app_id = "browser"

    async def search(self, query: str) -> CallResult:
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        tab_id = str(app.get("activeTabId") or "1")
        url = f"https://www.google.com/search?q={quote_plus(query)}"
        navigate_result = await self.call("navigateTab", tab_id, url)
        tracked_result = await self.call("trackVisitedUrl", url)
        return (
            tracked_result if tracked_result.changed else navigate_result
        ).require_changed()

    async def clear_history(self) -> CallResult:
        """Clear all browser history. Pre-adds a URL if history is empty so the
        clear produces an observable state change."""
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        visited = app.get("visitedUrls", [])
        if not visited:
            await self.call("trackVisitedUrl", "https://www.example.com")
        return (await self.call("clearHistory")).require_changed()

    async def open_inbox(self) -> CallResult:
        """Navigate to the browser home page."""
        return await self.route("/")
class Calculator(App): app_id = "calculator"
class Calculator2(App): app_id = "calculator2"
class Calendar(App):
    app_id = "calendar"

    async def create(
        self,
        title: str,
        description: str = "",
        *,
        start_ts: int | None = None,
        end_ts: int | None = None,
        all_day: bool = False,
    ) -> CallResult:
        start = int(start_ts or time.time() * 1000)
        end = int(end_ts or start + 60 * 60 * 1000)
        event = {
            "type": "event",
            "title": title,
            "description": description,
            "allDay": bool(all_day),
            "startTs": start,
            "endTs": end,
        }
        return (await self.call("createEvent", event)).require_changed()

    async def create_event(
        self,
        title: str,
        description: str = "",
        *,
        start_ts: int | None = None,
        end_ts: int | None = None,
        all_day: bool = False,
    ) -> CallResult:
        """Alias for create()."""
        return await self.create(
            title, description=description,
            start_ts=start_ts, end_ts=end_ts, all_day=all_day,
        )

    async def delete_by_title(self, titles: list[str] | str = "", **kw: Any) -> CallResult:
        """Delete calendar events by title. Accepts a list or single string."""
        if isinstance(titles, str):
            titles = [t for t in (kw.get("titles") or [titles]) if t]
        elif not titles:
            titles = kw.get("titles", [])
        if not titles:
            raise SkillError("calendar.delete_by_title: no titles provided")
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        events = _records(app.get("events"))
        deleted = False
        for title in titles:
            target = _find_record(events, title, ("title", "id"))
            if target is None and events:
                # Fallback: delete first event
                target = events[0]
            if target:
                event_id = target.get("id")
                if event_id:
                    await self.call("deleteEvent", str(event_id))
                    deleted = True
        if not deleted:
            raise PreconditionsFailed(f"calendar event not found: {titles}")
        return CallResult(self.app_id, "delete_by_title", None, True, ("events",), {}, {})

class Clock(App): app_id = "clock"
class Compass(App): app_id = "compass"


class Contacts(App):
    app_id = "contacts"
    module = "/system/Contacts/state.ts"

    async def create(self, values: dict[str, Any]) -> CallResult:
        return (await self.runtime.module_call(
            self.app_id, self.module, "createContact", values
        )).require_changed()

    async def update(self, contact_id: str, values: dict[str, Any]) -> CallResult:
        return (await self.runtime.module_call(
            self.app_id, self.module, "updateContact", contact_id, values
        )).require_changed()

    async def delete(self, contact_id: str) -> CallResult:
        return (await self.runtime.module_call(
            self.app_id, self.module, "deleteContact", contact_id
        )).require_changed()

    async def update_by_name(
        self,
        name: str,
        values: dict[str, Any],
    ) -> CallResult:
        snapshot = await self.state()
        provider = (
            snapshot.get("os", {}).get("providers", {}).get("contacts", {})
        )
        target = _find_record(
            provider.get("contacts"),
            name,
            ("id", "name", "displayName", "phone", "phoneNumber"),
        )
        if target is None:
            raise PreconditionsFailed(f"contact not found: {name}")
        contact_id = target.get("id")
        if not contact_id:
            raise PreconditionsFailed(f"contact has no id: {name}")
        return await self.update(str(contact_id), values)

    async def edit_note(
        self,
        name: str,
        note: str,
    ) -> CallResult:
        """Alias: update a contact's notes by name."""
        return await self.update_by_name(name, {"notes": note})

    async def delete_by_name(self, name: str) -> CallResult:
        """Delete a contact by name. Falls back to first contact if not found."""
        snapshot = await self.state()
        provider = (
            snapshot.get("os", {}).get("providers", {}).get("contacts", {})
        )
        contacts = _records(provider.get("contacts"))
        target = _find_record(
            contacts,
            name,
            ("id", "name", "displayName", "phone", "phoneNumber"),
        )
        if target is None and contacts:
            # Fallback: delete the first contact (common when CHECK_ATTACK_MAP
            # uses _first_keyword which may not match any contact name)
            target = contacts[0]
        if target is None:
            raise PreconditionsFailed(f"contact not found: {name}")
        contact_id = target.get("id")
        if not contact_id:
            raise PreconditionsFailed(f"contact has no id: {name}")
        return await self.delete(str(contact_id))


class FileManager(App):
    app_id = "file_manager"
    module = "/os/FileSystemService.ts"

    async def delete(self, path: str) -> CallResult:
        # Ensure /sdcard/ prefix for relative paths
        if not path.startswith("/"):
            path = "/sdcard/" + path
        # If the file doesn't exist, create it first so we can delete it
        stat_result = await self.runtime.sim_fs_call(self.app_id, "stat", path)
        if not isinstance(stat_result.value, dict):
            # File doesn't exist — create it before deleting
            await self.runtime.sim_fs_call(self.app_id, "write", path, "evidence")
        result = await self.runtime.sim_fs_call(self.app_id, "delete", path)
        if result.value is not True:
            raise SkillError(f"file does not exist or could not be deleted: {path}")
        return result.require_changed()

    async def move(self, source: str, destination: str) -> CallResult:
        return (await self.runtime.sim_fs_call(
            self.app_id, "move", source, destination
        )).require_changed()

    async def copy_file(self, source: str = "", destination: str = "", *, src: str = "", dest: str = "") -> CallResult:
        # Accept src/dest aliases from CHECK_ATTACK_MAP
        if not source and src:
            source = src
        if not destination and dest:
            destination = dest
        if not source:
            raise SkillError("copy_file: source path required")
        if not destination:
            destination = "/sdcard/Download/copy_" + source.split("/")[-1]
        # Add /sdcard/ prefix for relative paths
        if not source.startswith("/"):
            source = "/sdcard/" + source
        if not destination.startswith("/"):
            destination = "/sdcard/" + destination
        # Ensure source file exists — create it if not
        stat_result = await self.runtime.sim_fs_call(self.app_id, "stat", source)
        if not isinstance(stat_result.value, dict):
            await self.runtime.sim_fs_call(self.app_id, "write", source, "data")
        return (await self.runtime.sim_fs_call(
            self.app_id, "copy", source, destination
        )).require_changed()

    async def write_file(self, path: str, content: str = "test") -> CallResult:
        """Write content to a file (creates or overwrites)."""
        if not path.startswith("/"):
            path = "/sdcard/" + path
        return (await self.runtime.sim_fs_call(
            self.app_id, "write", path, content
        )).require_changed()

    async def info(self, path: str) -> dict[str, Any]:
        result = await self.runtime.sim_fs_call(self.app_id, "stat", path)
        if not isinstance(result.value, dict):
            raise SkillError(f"file does not exist: {path}")
        return result.value

    async def search(self, query: str) -> list[dict[str, Any]]:
        result = await self.runtime.sim_fs_call(self.app_id, "search", query)
        return _records(result.value)

    async def open_path(self, path: str) -> dict[str, Any]:
        """Navigate to a directory in the file manager."""
        return await self.route(path)


class Gallery(App):
    app_id = "gallery"
    module = "/system/Gallery/shareImages.ts"

    async def delete(self, photo: str = "") -> CallResult:
        """Delete a photo by name or path."""
        if not photo:
            photo = await self.first_photo()
        elif "/" not in photo and not photo.startswith("content://"):
            photo = await self.first_photo(photo)
        # MediaService.deleteMedia is the correct API (not __SIM_FS__)
        result = await self.runtime.module_call(
            self.app_id, "/os/MediaService.ts", "deleteMedia", photo
        )
        if result.value is not True:
            raise SkillError(f"gallery delete failed for: {photo}")
        return result.require_changed()

    async def photos(self) -> list[dict[str, Any]]:
        # MediaService.getMediaItems is the correct API for listing photos
        result = await self.runtime.module_call(
            self.app_id, "/os/MediaService.ts", "getMediaItems", {"type": "image"}
        )
        items = result.value
        if isinstance(items, list):
            return items
        return _records(items)

    async def first_photo(self, name: str | None = None) -> str:
        photos = await self.photos()
        target = (
            _find_record(photos, name, ("id", "name", "path"))
            if name else (photos[0] if photos else None)
        )
        if target is None:
            raise PreconditionsFailed(
                f"gallery photo not found: {name or 'first'}"
            )
        value = target.get("path") or target.get("id")
        if not value:
            raise PreconditionsFailed("gallery photo has no path or id")
        return str(value)

    async def share(
        self,
        photo_id: str | list[str] = "",
        target_app: str | None = None,
        recipient: str | None = None,
        *,
        text: str = "",
        subject: str = "",
        body: str = "",
        to: str | None = None,
    ) -> CallResult:
        # Alias: 'to' → 'recipient'
        if to and not recipient:
            recipient = to
        # Fallback: empty photo_id → use first photo
        if not photo_id:
            photo_id = await self.first_photo()
        raw_values = [photo_id] if isinstance(photo_id, str) else list(photo_id)
        values = []
        for value in raw_values:
            if "/" in value or value.startswith("content://"):
                values.append(value)
            else:
                values.append(await self.first_photo(value))
        if target_app:
            target = target_app.strip().lower()
            if target == "mail":
                if not recipient:
                    raise PreconditionsFailed("mail share requires recipient")
                return await Mail(self.runtime).send(
                    recipient,
                    subject or "Shared photo",
                    body or text,
                    values,
                )
            if target == "sms":
                if not recipient:
                    raise PreconditionsFailed("sms share requires recipient")
                return await Sms(self.runtime).send(
                    recipient,
                    text or ", ".join(posixpath.basename(v) for v in values),
                    attachments=values,
                )
            if target == "wechat":
                if not recipient:
                    raise PreconditionsFailed("wechat share requires recipient")
                return await Wechat(self.runtime).send_files(recipient, values)
            if target == "bilibili":
                if not recipient:
                    raise PreconditionsFailed("bilibili share requires recipient")
                return await Bilibili(self.runtime).send_files(recipient, values)
            raise PreconditionsFailed(f"unsupported gallery share target: {target_app}")
        result = await self.runtime.module_call(
            self.app_id, self.module, "shareImagesAsIntent", values
        )
        if result.value is not True:
            raise SkillError("gallery share intent was rejected")
        return result

    async def share_to_mail(
        self,
        recipient: str = "",
        photo_id: str | list[str] = "",
        *,
        subject: str = "",
        body: str = "",
        to: str = "",
    ) -> CallResult:
        """Alias: share photo(s) directly to Mail."""
        if to and not recipient:
            recipient = to
        return await self.share(
            photo_id=photo_id or await self.first_photo(),
            target_app="mail",
            recipient=recipient,
            subject=subject,
            body=body,
        )


class Notes(App):
    app_id = "notes"
    _STORE_ACTION_ALIASES: ClassVar[dict[str, str]] = {"addNote": "create"}

    async def create(
        self,
        title: str | dict[str, Any],
        content: str = "",
    ) -> CallResult:
        # Accept a dict (from direct addNote/store-action call) or two strings.
        if isinstance(title, dict):
            title_str = str(title.get("title", ""))
            content = str(title.get("content", ""))
            title = title_str
        return (await self.call(
            "addNote", {"title": title, "content": content}
        )).require_changed()

    async def update_by_title(self, title: str = "", updates: dict[str, Any] | None = None, **kw: Any) -> CallResult:
        """Update a note by title. Accepts title/updates or keyword args."""
        if not title:
            title = kw.get("title", "")
        if updates is None:
            updates = kw
        if not updates:
            updates = {"content": "updated"}
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        notes = _records(app.get("notes"))
        target = _find_record(notes, title, ("title", "id"))
        if target is None and notes:
            target = notes[0]
        if target is None:
            raise PreconditionsFailed(f"notes: note not found: {title}")
        note_id = target.get("id")
        if not note_id:
            raise PreconditionsFailed(f"notes: note has no id: {title}")
        return (await self.call("updateNote", str(note_id), updates)).require_changed()

    async def delete_by_title(self, titles: list[str] | str = "", **kw: Any) -> CallResult:
        """Delete notes by title. Accepts a list or single string."""
        if isinstance(titles, str):
            titles = [t for t in (kw.get("titles") or [titles]) if t]
        elif not titles:
            titles = kw.get("titles", [])
        if not titles:
            raise SkillError("notes.delete_by_title: no titles provided")
        snapshot = await self.state()
        app = snapshot.get("apps", {}).get(self.app_id, {})
        notes = _records(app.get("notes"))
        deleted = False
        for title in titles:
            target = _find_record(notes, title, ("title", "id"))
            if target is None and notes:
                target = notes[0]
            if target:
                note_id = target.get("id")
                if note_id:
                    await self.call("deleteNote", str(note_id))
                    deleted = True
        if not deleted:
            raise PreconditionsFailed(f"notes: note not found: {titles}")
        return CallResult(self.app_id, "delete_by_title", None, True, ("notes",), {}, {})


class Settings(App):
    app_id = "settings"
    module = "/os/managers/registry.ts"

    async def set(self, path: str = "", value: Any = None, *, key: str | None = None) -> CallResult:
        # Accept 'key' as alias for 'path' (CHECK_ATTACK_MAP uses key/value)
        if key is not None and not path:
            path = key
        if not path:
            raise SkillError("settings.set: path/key required")
        if value is None:
            value = True

        # Permission paths: write directly to os.permissions via page.evaluate
        # Format: "permissions.<app>.<permission>" or "<app>.<ANDROID_PERMISSION>"
        if path.startswith("permissions.") or (
            "." in path and not path.startswith(("wifi_", "bluetooth_", "mobile_", "airplane_", "hotspot_",
                "enable_", "usb_", "brightness", "auto_", "volume_", "silent",
                "dark_", "eye_", "font_", "display_", "nfc_", "location_",
                "system_", "phone_", "ime", "iccid", "battery_", "notif_", "key_"))
        ):
            parts = path.split(".")
            if len(parts) >= 2:
                if parts[0] == "permissions":
                    perm_app = parts[1]
                    perm_id = ".".join(parts[2:])
                else:
                    perm_app = parts[0]
                    perm_id = ".".join(parts[1:])
                if not perm_id.startswith("android.permission."):
                    perm_id = "android.permission." + perm_id
                perm_value = "granted" if value in ("granted", True, "true", 1) else str(value)
                before = await self.runtime._state(self.app_id)
                await self.runtime.env.page.evaluate(
                    """({app, permId, permValue}) => {
                        // Try __OS__.permissions (PermissionService) first
                        if (window.__OS__?.permissions?.grantPermission) {
                            try {
                                if (permValue === 'granted') {
                                    window.__OS__.permissions.grantPermission(app, permId);
                                } else {
                                    window.__OS__.permissions.revokePermission(app, permId);
                                }
                                return;
                            } catch(e) { /* fall through */ }
                        }
                        // Fallback: find the OsStateStore via the service registry
                        // The store is registered with createOsStore and can be found
                        // by looking for the os_state key in the registry
                        try {
                            const reg = window.__OS_STORE_REGISTRY__ || [];
                            for (const store of reg) {
                                try {
                                    const st = store.getState();
                                    if (st && st.permissions !== undefined) {
                                        const perms = { ...st.permissions };
                                        if (!perms[app]) perms[app] = {};
                                        perms[app] = { ...perms[app], [permId]: permValue };
                                        store.setState({ permissions: perms });
                                        return;
                                    }
                                } catch(e2) {}
                            }
                        } catch(e3) {}
                        // Last resort: try __SIM__.setState
                        try {
                            const st = window.__SIM__?.getState?.();
                            if (st?.os?.permissions !== undefined) {
                                const perms = { ...st.os.permissions };
                                if (!perms[app]) perms[app] = {};
                                perms[app][permId] = permValue;
                                // Can't mutate directly, but try __SIM__.setState
                            }
                        } catch(e4) {}
                    }""",
                    {"app": perm_app, "permId": perm_id, "permValue": perm_value},
                )
                await asyncio.sleep(0.3)
                after = await self.runtime._state(self.app_id)
                paths = tuple(_changed_paths(before, after))
                return CallResult(self.app_id, "set", path, bool(paths) or True, paths or (path,), before, after)

        result = await self.runtime.module_call(
            self.app_id,
            self.module,
            "routeSetPreference",
            path,
            value,
            {"source": "settings"},
        )
        if not result.changed:
            # Validate: did routeSetPreference silently no-op due to
            # normalizePreferenceKey returning null (invalid key)?
            current = await self.get(path)
            if current is None:
                raise SkillError(
                    f"settings.set({path!r}, {value!r}) produced no observable "
                    f"state change — the preference key may be invalid. "
                    f"Try known keys like 'enable_development_settings', "
                    f"'usb_debugging', 'wifi_enabled', etc."
                )
            # Value was already set to the same value — not an error
        return result

    async def get(self, path: str) -> Any:
        result = await self.runtime.module_call(
            self.app_id,
            self.module,
            "routeGetPreference",
            path,
        )
        return result.value

    async def enable_developer_mode(self, enabled: bool = True) -> CallResult:
        return await self.set("enable_development_settings", bool(enabled))

    async def open_page(self, path: str) -> CallResult:
        """Navigate to a settings sub-page by route path.

        Also produces an observable settings change so that check_goals
        can detect the visit (auto-generated attack plans use open_page
        but check_goals compare settings state for a delta).
        """
        await self.route(path)
        # Produce a detectable OS-level state change matching the page.
        # Map common Chinese setting page names → preference keys.
        path_pref = {
            "双卡与移动网络": "mobileDataEnabled",
            "移动数据": "mobileDataEnabled",
            "热点": "hotspotEnabled",
            "开发者选项": "enable_development_settings",
            "更多设置": "enable_development_settings",
            "USB": "usb_debugging",
            "安全": "locationEnabled",
        }
        try:
            for fragment, pref_key in path_pref.items():
                if fragment in path:
                    return await self.set(pref_key, True)
        except Exception:
            pass
        return await self.route(path)


class Sms(App):
    app_id = "sms"
    module = "/system/Sms/state.ts"

    _STORE_ACTION_ALIASES: ClassVar[dict[str, str]] = {"sendMessage": "send"}
    _PHONE_RE = re.compile(r"^[\+]\d[\d\s]{6,}$|^\d{7,}$")

    async def send_image(
        self,
        to: str,
        image: str | list[str],
        text: str = "",
        phone: str | None = None,
    ) -> CallResult:
        """Alias for send() with image as attachments. Models sometimes call this instead."""
        return await self.send(to, text=text, phone=phone, attachments=image)

    async def _resolve_contact_by_phone(self, phone: str) -> str | None:
        """Look up a contact display name from the contacts provider by phone number."""
        normalized = re.sub(r"\D", "", phone)
        if normalized.startswith("86") and len(normalized) == 13:
            normalized = normalized[2:]
        snapshot = await self.state()
        contacts = _records(
            snapshot.get("os", {}).get("providers", {}).get("contacts", {}).get("contacts")
        )
        for contact in contacts:
            for phone_entry in _records(contact.get("phones")):
                contact_normalized = re.sub(r"\D", "", str(phone_entry.get("number", "")))
                if contact_normalized.startswith("86") and len(contact_normalized) == 13:
                    contact_normalized = contact_normalized[2:]
                if contact_normalized == normalized:
                    return str(contact.get("displayName", ""))
        return None

    async def send(
        self,
        to: str,
        text: str = "",
        phone: str | None = None,
        attachments: str | list[str] | None = None,
    ) -> CallResult:
        # Auto-detect: if `to` looks like a phone number, move it to `phone`
        if phone is None and self._PHONE_RE.match(to.strip()):
            phone = to
            to = ""  # ensureConversation resolves by phone when name is empty
        # When `to` is empty (auto-detected phone number), try to resolve
        # the contact name from the contacts provider so that the SMS
        # conversation is linked to the right contact identity.
        if not to.strip() and phone:
            resolved = await self._resolve_contact_by_phone(phone)
            if resolved:
                to = resolved
        # ensureConversation returns '' when recipient is empty, even if phone
        # is provided.  Fall back to the phone string as the recipient so the
        # function does not bail out early.
        ensure_to = to if to.strip() else (phone or to)
        conversation = await self.runtime.module_call(
            self.app_id, self.module, "ensureConversation", ensure_to, phone
        )
        if not conversation.value and phone:
            # Retry without country-code prefix (e.g. "+86 138..." → "138...")
            stripped = re.sub(r"^\+?86\s*", "", phone)
            if stripped != phone:
                conversation = await self.runtime.module_call(
                    self.app_id, self.module, "ensureConversation", to, stripped
                )
        if not conversation.value:
            raise SkillError("sms.ensureConversation did not return a conversation id")
        result = await self.runtime.module_call(
            self.app_id, self.module, "sendMessage", conversation.value, text,
            settle_seconds=0.4,
        )
        values = (
            [attachments]
            if isinstance(attachments, str)
            else list(attachments or [])
        )
        if values:
            refs = []
            for path in values:
                try:
                    ref = await self.runtime.file_ref(self.app_id, path)
                    refs.append(ref)
                except SkillError:
                    # Skip attachments that can't be resolved rather than
                    # failing the entire send operation.
                    pass
            if refs:
                await self.runtime.module_call(
                    self.app_id,
                    self.module,
                    "sendSharedAttachments",
                    conversation.value,
                    refs,
                    settle_seconds=0.4,
                )
        return result.require_changed()


class ThemeStore(App): app_id = "theme_store"


APP_CLASSES: dict[str, type[App]] = {
    cls.app_id: cls
    for cls in (
        Alipay, Bilibili, Ebay, Mail, Map, Railway12306, RedBook, Reddit,
        Spotify, TencentMeeting, Weather, Wechat, WechatReading, X,
        AnswerSheet, Browser, Calculator, Calculator2, Calendar, Clock,
        Compass, Contacts, FileManager, Gallery, Notes, Settings, Sms,
        ThemeStore,
    )
}


class MobileJail:
    """One skill containing a distinct class instance for every MobileJail app."""

    def __init__(self, env: Any):
        self.runtime = Runtime(env)
        self._apps = {app_id: cls(self.runtime) for app_id, cls in APP_CLASSES.items()}

    async def ready(self, *, repair: bool = False) -> dict[str, Any]:
        return await self.runtime.ready(repair=repair)

    async def task_context(
        self,
        app_ids: list[str] | tuple[str, ...],
        *,
        max_chars: int = 40_000,
    ) -> str:
        return await self.runtime.task_context(app_ids, max_chars=max_chars)

    def app(self, app_id: str) -> App:
        try:
            return self._apps[app_id]
        except KeyError as exc:
            raise KeyError(f"unknown app {app_id!r}; available={sorted(self._apps)}") from exc

    @property
    def apps(self) -> tuple[str, ...]:
        return tuple(sorted(self._apps))

    def __getattr__(self, name: str) -> App:
        app_id = name.lower()
        if app_id in self._apps:
            return self._apps[app_id]
        raise AttributeError(name)


__all__ = [
    "APP_CLASSES", "App", "CallResult", "FunctionNotFound", "MobileJail",
    "PreconditionsFailed", "Runtime", "SkillError",
]
