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

    async def comment(self, video_id: str, text: str) -> CallResult:
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


class Ebay(App):
    app_id = "ebay"

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
        accounts = _records(
            snapshot.get("apps", {}).get(self.app_id, {})
            .get("auth", {}).get("accounts")
        )
        account = (
            _find_record(accounts, username, ("username",))
            if username else (accounts[0] if accounts else None)
        )
        if account is None:
            raise PreconditionsFailed("ebay account not found")
        return (await self.call(
            "login",
            username or str(account.get("username", "")),
            password or str(account.get("password", "")),
        )).require_changed()


class Mail(App):
    app_id = "mail"
    module = "/apps/Mail/state.ts"

    async def send(
        self,
        to: str | list[str],
        subject: str,
        body: str,
        attachments: list[str | dict[str, Any]] | None = None,
    ) -> CallResult:
        recipients = [to] if isinstance(to, str) else list(to)
        normalized_attachments = []
        for attachment in attachments or []:
            if isinstance(attachment, str):
                ref = await self.runtime.file_ref(self.app_id, attachment)
                mime_type = str(ref.get("mimeType") or "application/octet-stream")
                normalized_attachments.append({
                    "name": ref.get("name") or posixpath.basename(attachment),
                    "type": "image" if mime_type.startswith("image/") else "file",
                    "mimeType": mime_type,
                    "size": int(ref.get("size") or 0),
                    "uri": ref.get("uri"),
                    "fileRef": ref,
                })
            else:
                normalized_attachments.append(dict(attachment))
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


class Map(App): app_id = "map"


class Railway12306(App):
    app_id = "railway12306"

    async def search(
        self,
        origin: str,
        destination: str,
        date: str | None = None,
    ) -> CallResult:
        await self.call("setFrom", origin)
        await self.call("setTo", destination)
        if date:
            await self.call("setDate", date)
        return (await self.call(
            "executeQuery", settle_seconds=0.2
        )).require_changed()


class RedBook(App):
    app_id = "redbook"

    async def comment(
        self,
        note_id: str,
        text: str,
        image: str | None = None,
    ) -> CallResult:
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
        if target is None:
            raise PreconditionsFailed(f"redbook note not found for author: {author}")
        note_id = target.get("id")
        if not note_id:
            raise PreconditionsFailed("redbook note has no id")
        return await self.comment(str(note_id), text, image=image)

    async def publish(
        self,
        title: str,
        content: str,
        images: list[str] | None = None,
    ) -> CallResult:
        return (await self.call(
            "addNote",
            {"title": title, "content": content, "images": images or []},
        )).require_changed()


class Reddit(App): app_id = "reddit"
class Spotify(App):
    app_id = "spotify"

    async def create_playlist(self, name: str) -> CallResult:
        return (await self.call("createPlaylist", name, None)).require_changed()


class TencentMeeting(App):
    app_id = "tencent_meeting"

    async def join(self, host_or_title: str) -> CallResult:
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


class WechatReading(App): app_id = "wechat_reading"


class X(App):
    app_id = "x"

    async def publish(self, text: str, images: list[str] | None = None) -> CallResult:
        return (await self.call("addPost", text, images or [])).require_changed()


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


class FileManager(App):
    app_id = "file_manager"
    module = "/os/FileSystemService.ts"

    async def delete(self, path: str) -> CallResult:
        result = await self.runtime.sim_fs_call(self.app_id, "delete", path)
        if result.value is not True:
            raise SkillError(f"file does not exist or could not be deleted: {path}")
        return result.require_changed()

    async def move(self, source: str, destination: str) -> CallResult:
        return (await self.runtime.sim_fs_call(
            self.app_id, "move", source, destination
        )).require_changed()

    async def copy_file(self, source: str, destination: str) -> CallResult:
        return (await self.runtime.sim_fs_call(
            self.app_id, "copy", source, destination
        )).require_changed()

    async def info(self, path: str) -> dict[str, Any]:
        result = await self.runtime.sim_fs_call(self.app_id, "stat", path)
        if not isinstance(result.value, dict):
            raise SkillError(f"file does not exist: {path}")
        return result.value

    async def search(self, query: str) -> list[dict[str, Any]]:
        result = await self.runtime.sim_fs_call(self.app_id, "search", query)
        return _records(result.value)


class Gallery(App):
    app_id = "gallery"
    module = "/system/Gallery/shareImages.ts"

    async def photos(self) -> list[dict[str, Any]]:
        result = await self.runtime.sim_fs_call(
            self.app_id, "getMedia", "image"
        )
        return _records(result.value)

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
        photo_id: str | list[str],
        target_app: str | None = None,
        recipient: str | None = None,
        *,
        text: str = "",
        subject: str = "",
        body: str = "",
    ) -> CallResult:
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


class Notes(App):
    app_id = "notes"

    async def create(self, title: str, content: str) -> CallResult:
        return (await self.call(
            "addNote", {"title": title, "content": content}
        )).require_changed()


class Settings(App):
    app_id = "settings"
    module = "/os/managers/registry.ts"

    async def set(self, path: str, value: Any) -> CallResult:
        return (await self.runtime.module_call(
            self.app_id,
            self.module,
            "routeSetPreference",
            path,
            value,
            {"source": "settings"},
        )).require_changed()

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


class Sms(App):
    app_id = "sms"
    module = "/system/Sms/state.ts"

    async def send(
        self,
        to: str,
        text: str,
        phone: str | None = None,
        attachments: str | list[str] | None = None,
    ) -> CallResult:
        conversation = await self.runtime.module_call(
            self.app_id, self.module, "ensureConversation", to, phone
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
            refs = [
                await self.runtime.file_ref(self.app_id, path)
                for path in values
            ]
            result = await self.runtime.module_call(
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
