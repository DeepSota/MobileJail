"""Declarative task preparation contracts.

The canonical input is a list of ``{"action", "app", "params"}`` objects.
Each action has one shared executor and one independent postcondition verifier.
Task classes only declare ``prepare_plan``; they do not implement bespoke
``_prepare`` methods.
"""

from __future__ import annotations

import base64
import copy
import datetime
import hashlib
import re
from dataclasses import asdict, dataclass
from typing import Any, Awaitable, Callable

from bench_env.task.judge import StateComparator


PreparePlan = list[dict[str, Any]]
ANDROID_PERMISSION_PREFIX = "android.permission."


class PreparePlanError(RuntimeError):
    """Raised when a declarative preparation step cannot be proven correct."""


@dataclass(frozen=True)
class PrepareStepReport:
    task_id: str
    index: int
    action: str
    app: str
    passed: bool
    changed_paths: list[str]
    allowed_paths: list[str]
    evidence: Any

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PreparePlanReport:
    task_id: str
    success: bool
    steps: list[PrepareStepReport]

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "success": self.success,
            "steps": [step.to_dict() for step in self.steps],
        }


ApplyFn = Callable[[Any, dict[str, Any], str, dict[str, Any]], Awaitable[None]]
VerifyFn = Callable[
    [Any, dict[str, Any], dict[str, Any], str, dict[str, Any]],
    Awaitable[tuple[bool, Any]],
]
AllowedPathsFn = Callable[[str, dict[str, Any]], tuple[str, ...]]


@dataclass(frozen=True)
class PrepareActionContract:
    action: str
    apps: frozenset[str]
    required_params: frozenset[str]
    optional_params: frozenset[str]
    apply: ApplyFn
    verify: VerifyFn
    allowed_paths: AllowedPathsFn


_VOLATILE_PATHS = (
    "ui_elements",
    "os.time",
    "os.preferences",
    "os.activeAppId",
    "os.activeTaskId",
    "os.isLauncherVisible",
    "os.runningApps",
    "os.tasks",
    "os.services.taskManager",
)


def _stable_id(*parts: str) -> str:
    payload = "\0".join(parts).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _set_dotted(root: dict[str, Any], path: str, value: Any) -> None:
    parts = [part for part in path.split(".") if part]
    if not parts:
        raise ValueError("dotted path must not be empty")
    cursor = root
    for part in parts[:-1]:
        child = cursor.get(part)
        if child is None:
            child = {}
            cursor[part] = child
        if not isinstance(child, dict):
            raise ValueError(f"cannot descend through non-object path segment {part!r}")
        cursor = child
    cursor[parts[-1]] = copy.deepcopy(value)


def _state_path_parts(path: str) -> list[str]:
    """Resolve canonical simulator keys while keeping source paths readable."""
    parts = [part for part in str(path).split(".") if part]
    if "permissions" in parts:
        index = parts.index("permissions")
        if len(parts) <= index + 2:
            raise ValueError(f"permission path must include app and permission: {path!r}")
        permission_id = ".".join(parts[index + 2:])
        if not permission_id.startswith(ANDROID_PERMISSION_PREFIX):
            permission_id = f"{ANDROID_PERMISSION_PREFIX}{permission_id}"
        parts = [*parts[:index + 2], permission_id]
    return parts


def canonical_state_path(path: str) -> str:
    """Return the path form used by real simulator snapshots and diffs."""
    return ".".join(_state_path_parts(path))


def read_state_path(root: dict[str, Any], path: str) -> Any:
    """Read a required state path, including Android permission-ID keys."""
    cursor: Any = root
    for part in _state_path_parts(path):
        cursor = cursor[part]
    return cursor


def set_state_path(root: dict[str, Any], path: str, value: Any) -> None:
    """Write a state path using the same canonical key resolution as judges."""
    parts = _state_path_parts(path)
    if not parts:
        raise ValueError("state path must not be empty")
    cursor = root
    for part in parts[:-1]:
        child = cursor.get(part)
        if child is None:
            child = {}
            cursor[part] = child
        if not isinstance(child, dict):
            raise ValueError(f"cannot descend through non-object path segment {part!r}")
        cursor = child
    cursor[parts[-1]] = copy.deepcopy(value)


def _path_allowed(path: str, allowed: tuple[str, ...]) -> bool:
    if any(path == prefix or path.startswith(prefix + ".") or path.startswith(prefix + "[") for prefix in _VOLATILE_PATHS):
        return True
    return any(
        path == prefix
        or path.startswith(prefix + ".")
        or path.startswith(prefix + "[")
        or prefix.startswith(path + ".")
        or prefix.startswith(path + "[")
        for prefix in allowed
    )


def _changed_paths(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    return sorted({str(item["path"]) for item in StateComparator.diff_states(before, after)})


async def _set_state(env: Any, patch: dict[str, Any]) -> None:
    await env.set_state(patch, deep=True, reload=False)


async def _write_sim_file(
    env: Any,
    path: str,
    content: str | bytes,
    *,
    mime_type: str = "text/plain",
) -> None:
    if isinstance(content, str):
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    else:
        encoded = base64.b64encode(content).decode("ascii")
    await env.page.evaluate(
        """async ({path, encoded, mimeType}) => {
            if (!window.__SIM_FS__) throw new Error("__SIM_FS__ not available");
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            await window.__SIM_FS__.write(
                path,
                bytes.buffer,
                {mimeType, createdAt: window.__SIM_TIME__?.now?.() ?? 1773619200000},
            );
            if (!window.__SIM_FS__.stat(path)) {
                throw new Error(`${path} not found after write`);
            }
        }""",
        {"path": path, "encoded": encoded, "mimeType": mime_type},
    )


def _fs_node(state: dict[str, Any], path: str) -> dict[str, Any] | None:
    nodes = state["os"]["fileSystem"]["nodes"]
    return next((node for node in nodes if str(node["path"]) == path), None)


async def _apply_contacts_add(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_contacts_provider_with_entry

    contacts_state = copy.deepcopy(state["os"]["providers"]["contacts"])
    name = str(params["name"])
    phone = str(params["phone"])
    contacts_state["contacts"] = [
        contact
        for contact in contacts_state.get("contacts", [])
        if not (
            str(contact.get("displayName")) == name
            or any(
                str(item.get("number")) == phone
                for item in contact.get("phones", [])
            )
        )
    ]
    patch = prepare_contacts_provider_with_entry(
        contacts_state,
        name=name,
        phone=phone,
        contact_id=f"prep_contact_{_stable_id(step_id)}",
        company=str(params.get("company") or ""),
        note=str(params.get("notes") or ""),
    )
    await _set_state(env, patch)


async def _verify_contacts_add(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    expected_id = f"prep_contact_{_stable_id(step_id)}"
    matches = []
    for contact in after["os"]["providers"]["contacts"]["contacts"]:
        phones = contact["phones"]
        if (
            str(contact["id"]) == expected_id
            and str(contact["displayName"]) == str(params["name"])
            and any(str(phone["number"]) == str(params["phone"]) for phone in phones)
        ):
            matches.append({
                "id": contact["id"],
                "displayName": contact["displayName"],
                "phones": phones,
            })
    return len(matches) == 1, matches


async def _apply_wechat_incoming(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    app = copy.deepcopy(state["apps"]["wechat"])
    name = str(params["contact_name"])
    contact = next(
        (
            item
            for item in app.get("contacts", [])
            if str(item.get("name")) == name or str(item.get("alias")) == name
        ),
        None,
    )
    if contact is None:
        wxid = f"prep_wxid_{_stable_id(step_id)}"
        contact = {
            "wxid": wxid,
            "name": name,
            "avatar": "",
            "category": "#",
            "signature": "",
            "alias": "",
            "region": "",
            "gender": "未知",
            "source": "task_prep",
            "addedTime": "2026年3月",
            "commonGroups": 0,
            "memo": "",
            "isBlacklisted": False,
            "steps": 0,
            "likes": 0,
            "permissionMode": "all",
            "hideMyMoments": False,
            "hideTheirMoments": False,
            "aiConfig": {"enabled": False, "systemPrompt": ""},
        }
        app.setdefault("contacts", []).append(contact)
    wxid = str(contact["wxid"])
    chat = next(
        (item for item in app.get("chats", []) if str(item.get("id")) == wxid),
        None,
    )
    if chat is None:
        chat = {
            "id": wxid,
            "user": {"wxid": wxid, "name": name, "avatar": str(contact.get("avatar") or "")},
            "isMuted": False,
            "isSticky": False,
            "isAlert": False,
            "messages": [],
        }
        app.setdefault("chats", []).insert(0, chat)
    chat.setdefault("messages", []).append({
        "id": f"prep_wechat_{_stable_id(step_id)}",
        "type": "text",
        "content": str(params["content"]),
        "senderId": wxid,
        "timestamp": 1773619200000,
    })
    await _set_state(
        env,
        prepare_app_state_with_patch("wechat", state["apps"]["wechat"], app),
    )


async def _verify_wechat_incoming(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    app = after["apps"]["wechat"]
    exact_contacts = [
        contact
        for contact in app["contacts"]
        if str(contact.get("name")) == str(params["contact_name"])
        or str(contact.get("alias")) == str(params["contact_name"])
    ]
    if len(exact_contacts) != 1:
        return False, {"contacts": exact_contacts, "messages": []}
    wxid = str(exact_contacts[0]["wxid"])
    chat = next(
        (item for item in app["chats"] if str(item.get("id")) == wxid),
        None,
    )
    matches = [
        message
        for message in (chat["messages"] if chat else [])
        if str(message["id"]) == f"prep_wechat_{_stable_id(step_id)}"
        and str(message["senderId"]) == wxid
        and str(message["content"]) == str(params["content"])
    ]
    return len(matches) == 1, matches


async def _apply_sms_incoming(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_sms_provider_with_incoming_message

    sender_name = str(params["sender_name"]).strip("“”\"'")
    patch = prepare_sms_provider_with_incoming_message(
        state["os"]["providers"]["sms"],
        sender_name,
        str(params["content"]),
        message_id=f"prep_sms_{_stable_id(step_id)}",
        phone_number=str(params["sender_phone"]),
    )
    await _set_state(env, patch)


async def _verify_sms_incoming(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    sms = after["os"]["providers"]["sms"]
    message_id = f"prep_sms_{_stable_id(step_id)}"
    matches = []
    for conversation_id, messages in sms["messagesByConversationId"].items():
        for message in messages:
            if (
                str(message["id"]) == message_id
                and str(message["content"]) == str(params["content"])
                and not bool(message["isOutgoing"])
            ):
                matches.append({"conversation_id": conversation_id, "message": message})
    return len(matches) == 1, matches


async def _apply_alipay_incoming(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    app = copy.deepcopy(state["apps"]["alipay"])
    name = _resolved_alipay_contact_name(state["apps"]["alipay"], params)
    contact = next(
        (item for item in app.get("contacts", []) if str(item.get("name")) == name),
        None,
    )
    if contact is None:
        contact_id = f"prep_alipay_contact_{_stable_id(step_id)}"
        contact = {
            "id": contact_id,
            "name": name,
            "phone": "",
            "account": "",
            "info": name,
            "avatar": "",
            "verified": False,
            "gender": "unknown",
        }
        app.setdefault("contacts", []).append(contact)
    contact_id = str(contact["id"])
    conversation = next(
        (
            item
            for item in app.get("conversations", [])
            if str(item.get("contactId")) == contact_id
        ),
        None,
    )
    if conversation is None:
        conversation_id = f"prep_alipay_conv_{_stable_id(step_id)}"
        conversation = {
            "id": conversation_id,
            "kind": "person",
            "contactId": contact_id,
            "name": name,
            "avatar": str(contact.get("avatar") or ""),
            "lastContent": "",
            "lastTimestamp": 1773619200000,
            "lastReadAt": 1773619200000,
        }
        app.setdefault("conversations", []).append(conversation)
    conversation_id = str(conversation["id"])
    message = {
        "id": f"prep_alipay_{_stable_id(step_id)}",
        "senderId": contact_id,
        "type": "text",
        "content": str(params["content"]),
        "timestamp": 1773619200000,
    }
    app.setdefault("chatHistory", {}).setdefault(conversation_id, []).append(message)
    conversation["lastContent"] = message["content"]
    conversation["lastTimestamp"] = message["timestamp"]
    conversation["unread"] = int(conversation.get("unread") or 0) + 1
    await _set_state(
        env,
        prepare_app_state_with_patch("alipay", state["apps"]["alipay"], app),
    )


async def _verify_alipay_incoming(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    app = after["apps"]["alipay"]
    name = _resolved_alipay_contact_name(before["apps"]["alipay"], params)
    message_id = f"prep_alipay_{_stable_id(step_id)}"
    exact_contact_ids = {
        str(contact["id"])
        for contact in app["contacts"]
        if str(contact["name"]) == name
    }
    matches = [
        message
        for messages in app["chatHistory"].values()
        for message in messages
        if str(message["id"]) == message_id
        and str(message["senderId"]) in exact_contact_ids
        and str(message["content"]) == str(params["content"])
    ]
    return len(matches) == 1, matches


def _resolved_alipay_contact_name(
    app_state: dict[str, Any], params: dict[str, Any],
) -> str:
    """Resolve the dataset's generic ``联系人`` token without task-specific code."""
    raw_name = str(params["contact_name"]).strip()
    if raw_name != "联系人":
        return raw_name
    content = str(params["content"])
    match = re.search(r"支付宝(?:联系人|好友)[“\"]([^”\"]+)[”\"]", content)
    if match:
        return match.group(1).strip()
    prepared = [
        contact
        for contact in app_state.get("contacts", [])
        if str(contact.get("id") or "").startswith("prep_alipay_contact_")
    ]
    if prepared:
        return str(prepared[-1]["name"])
    return raw_name


async def _apply_mail_incoming(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_mail_provider_with_incoming_email

    patch = prepare_mail_provider_with_incoming_email(
        state["os"]["providers"]["mail"],
        sender=str(params["sender"]),
        subject=str(params["subject"]),
        body=str(params["body"]),
        timestamp=str(params.get("time") or "09:00"),
        message_id=f"prep_mail_{_stable_id(step_id)}",
    )
    await _set_state(env, patch)


async def _verify_mail_incoming(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    message_id = f"prep_mail_{_stable_id(step_id)}"
    matches = [
        message
        for message in after["os"]["providers"]["mail"]["messages"]
        if str(message["id"]) == message_id
        and str(message["from"]) == str(params["sender"])
        and str(message["subject"]) == str(params["subject"])
        and str(message["body"]) == str(params["body"])
        and str(message["folder"]) == "inbox"
    ]
    return len(matches) == 1, matches


async def _apply_mail_draft(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    mail = copy.deepcopy(state["os"]["providers"]["mail"])
    accounts = mail["accounts"]
    account_id = str(accounts[0]["id"]) if accounts else "acc_sim"
    messages = list(mail["messages"])
    messages.append({
        "id": f"prep_draft_{_stable_id(step_id)}",
        "accountId": account_id,
        "folder": "drafts",
        "from": str(accounts[0].get("email") or "me@sim-mail.com") if accounts else "me@sim-mail.com",
        "fromName": str(accounts[0].get("name") or "Me") if accounts else "Me",
        "to": [str(params["recipient"])],
        "subject": str(params["subject"]),
        "body": str(params["body"]),
        "timestamp": "09:00",
        "isUnread": False,
        "isStarred": False,
        "isDraft": bool(params["unsent"]),
        "status": "draft" if bool(params["unsent"]) else "sent",
        "attachments": [],
    })
    mail["messages"] = messages
    await _set_state(env, {"os": {"providers": {"mail": mail}}})


async def _verify_mail_draft(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    message_id = f"prep_draft_{_stable_id(step_id)}"
    matches = [
        message
        for message in after["os"]["providers"]["mail"]["messages"]
        if str(message["id"]) == message_id
        and str(message["subject"]) == str(params["subject"])
        and str(message["body"]) == str(params["body"])
        and list(message["to"]) == [str(params["recipient"])]
        and bool(message["isDraft"]) == bool(params["unsent"])
    ]
    return len(matches) == 1, matches


async def _apply_clipboard_set(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    await env.page.evaluate(
        """(text) => {
            if (!window.__OS__?.clipboard?.copyText) {
                throw new Error("__OS__.clipboard.copyText not available");
            }
            window.__OS__.clipboard.copyText(text, "task_prep");
        }""",
        str(params["text"]),
    )


async def _verify_clipboard_set(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    current = after["os"]["clipboard"]
    passed = (
        isinstance(current, dict)
        and
        str(current["type"]) == "text"
        and str(current["content"]) == str(params["text"])
    )
    return passed, current


async def _apply_file_create(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    await _write_sim_file(env, str(params["path"]), str(params["content"]))


async def _verify_file_create(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    node = _fs_node(after, str(params["path"]))
    return node is not None, node


_TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "2wBDAf//////////////////////////////////////////////////////////////////////////////////////"
    "wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/"
    "9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a"
    "AAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAG"
    "PwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA"
    "/9oACAEDAQE/EF//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/"
    "EF//2Q=="
)


async def _apply_gallery_album(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    album = str(params["album_name"]).strip("/")
    for photo in params["photos"]:
        name = str(photo["name"])
        await _write_sim_file(
            env,
            f"/sdcard/DCIM/{album}/{name}",
            _TINY_JPEG,
            mime_type="image/jpeg",
        )


async def _verify_gallery_album(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    album = str(params["album_name"]).strip("/")
    paths = [f"/sdcard/DCIM/{album}/{photo['name']}" for photo in params["photos"]]
    nodes = [_fs_node(after, path) for path in paths]
    return all(node is not None for node in nodes), nodes


async def _apply_note_create(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    notes = list(state["apps"]["notes"]["notes"])
    notes.append({
        "id": f"prep_note_{_stable_id(step_id)}",
        "title": str(params["title"]),
        "content": str(params["content"]),
        "updatedAt": 1773619200000,
        "folderId": "unfiled",
    })
    await _set_state(
        env,
        prepare_app_state_with_patch("notes", state["apps"]["notes"], {"notes": notes}),
    )


async def _verify_note_create(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    note_id = f"prep_note_{_stable_id(step_id)}"
    matches = [
        note
        for note in after["apps"]["notes"]["notes"]
        if str(note["id"]) == note_id
        and str(note["title"]) == str(params["title"])
        and str(note["content"]) == str(params["content"])
    ]
    return len(matches) == 1, matches


async def _apply_redbook_note(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    app = copy.deepcopy(state["apps"]["redbook"])
    users = app["users"]
    author = next(
        (user for user in users.values() if str(user["name"]) == str(params["author"])),
        None,
    )
    if author is None:
        author_id = f"prep_redbook_user_{_stable_id(step_id)}"
        author = {"id": author_id, "name": str(params["author"]), "avatar": ""}
        users[author_id] = author
    note_id = f"prep_redbook_note_{_stable_id(step_id)}"
    notes = dict(app["notes"])
    notes[note_id] = {
        "id": note_id,
        "title": str(params["title"]),
        "content": str(params["content"]),
        "authorId": str(author["id"]),
        "images": [],
        "cover": "",
        "likes": 0,
        "collections": 0,
        "comments": 0,
        "commentList": [],
        "createdAt": 1773619200000,
    }
    await _set_state(
        env,
        prepare_app_state_with_patch(
            "redbook",
            state["apps"]["redbook"],
            {"users": users, "notes": notes},
        ),
    )


async def _verify_redbook_note(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    app = after["apps"]["redbook"]
    note_id = f"prep_redbook_note_{_stable_id(step_id)}"
    note = app["notes"].get(note_id)
    author = app["users"].get(str(note["authorId"])) if note else None
    passed = bool(
        note
        and author
        and str(note["title"]) == str(params["title"])
        and str(note["content"]) == str(params["content"])
        and str(author["name"]) == str(params["author"])
    )
    return passed, {"note": note, "author": author}


async def _apply_x_post_account(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    user = copy.deepcopy(state["apps"]["x"]["user"])
    if "username" in params:
        user["username"] = str(params["username"])
    if "display_name" in params:
        user["displayName"] = str(params["display_name"])
    user["isLoggedIn"] = True
    await _set_state(
        env,
        prepare_app_state_with_patch("x", state["apps"]["x"], {"user": user}),
    )


async def _verify_x_post_account(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    user = after["apps"]["x"]["user"]
    passed = bool(user["isLoggedIn"])
    if "username" in params:
        passed = passed and str(user["username"]) == str(params["username"])
    if "display_name" in params:
        passed = passed and str(user["displayName"]) == str(params["display_name"])
    return passed, user


async def _apply_app_state_patch(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    app = step_id.split("|", 3)[2]
    if app == "os":
        os_patch = copy.deepcopy(params["patch"])
        time_patch = os_patch.pop("time", None)
        if isinstance(time_patch, dict) and "iso_date" in time_patch:
            await env.page.evaluate(
                """({iso_date}) => {
                    if (!window.__SIM_TIME__?.setSimulatedTime) {
                        throw new Error("__SIM_TIME__.setSimulatedTime not available");
                    }
                    window.__SIM_TIME__.setSimulatedTime(`${iso_date} 12:00:00`, false);
                }""",
                {"iso_date": str(time_patch["iso_date"])},
            )
            remaining_time = {
                key: value for key, value in time_patch.items() if key != "iso_date"
            }
            if remaining_time:
                os_patch["time"] = remaining_time
        elif time_patch is not None:
            os_patch["time"] = time_patch
        if os_patch:
            await _set_state(env, {"os": _deep_merge(state["os"], os_patch)})
        return
    patch = prepare_app_state_with_patch(app, state["apps"][app], params["patch"])
    await _set_state(env, patch)


async def _verify_app_state_patch(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    app = step_id.split("|", 3)[2]

    def contains(actual: Any, expected: Any) -> bool:
        if isinstance(expected, dict):
            return isinstance(actual, dict) and all(
                key in actual and contains(actual[key], value)
                for key, value in expected.items()
            )
        return actual == expected

    actual = after["os"] if app == "os" else after["apps"][app]
    expected = copy.deepcopy(params["patch"])
    time_patch = expected.get("time") if app == "os" else None
    time_ok = True
    if isinstance(time_patch, dict) and "iso_date" in time_patch:
        timestamp = int(actual["time"]["timestamp"])
        actual_date = datetime.datetime.fromtimestamp(timestamp / 1000).date().isoformat()
        time_ok = actual_date == str(time_patch["iso_date"])
        time_patch.pop("iso_date")
        if not time_patch:
            expected.pop("time")
    return time_ok and contains(actual, expected), {
        "expected_patch": params["patch"],
        "time_ok": time_ok,
    }


async def _apply_settings_patch(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    path = str(params["key"])
    if not path.startswith("os."):
        raise ValueError(f"settings_patch key must start with 'os.': {path!r}")
    next_os = copy.deepcopy(state["os"])
    set_state_path(next_os, path.removeprefix("os."), params["value"])
    await _set_state(env, {"os": next_os})


async def _verify_settings_patch(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    path = str(params["key"])
    cursor = read_state_path(after, path)
    return cursor == params["value"], cursor


async def _apply_calendar_event(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_calendar_with_event

    patch = prepare_calendar_with_event(
        state["apps"]["calendar"],
        event_id=f"prep_event_{_stable_id(step_id)}",
        title=str(params["title"]),
        date_text=str(params["date"]),
        description=str(params["notes"]),
    )
    await _set_state(env, patch)


async def _verify_calendar_event(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    event_id = f"prep_event_{_stable_id(step_id)}"
    expected_start = int(
        datetime.datetime.fromisoformat(f"{params['date']}T10:00:00").timestamp() * 1000
    )
    matches = [
        event
        for event in after["apps"]["calendar"]["events"]
        if str(event["id"]) == event_id
        and str(event["title"]) == str(params["title"])
        and int(event["startTs"]) == expected_start
        and str(event["description"]) == str(params["notes"])
    ]
    return len(matches) == 1, matches


async def _apply_railway_login(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    app = copy.deepcopy(state["apps"]["railway12306"])
    app.setdefault("auth", {})["loggedIn"] = bool(params.get("is_logged_in", True))
    if "passenger" in params:
        passengers = list(app["passengers"])
        name = str(params["passenger"])
        if not any(str(passenger["name"]) == name for passenger in passengers):
            passengers.append({
                "id": str(params["passenger_id"]),
                "name": name,
                "idType": "1",
                "idNo": str(params["passenger_id"]),
                "isDefault": False,
                "ticketType": "成人",
            })
        app["passengers"] = passengers
    await _set_state(
        env,
        prepare_app_state_with_patch("railway12306", state["apps"]["railway12306"], app),
    )


async def _verify_railway_login(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    app = after["apps"]["railway12306"]
    passed = bool(app["auth"]["loggedIn"]) == bool(params.get("is_logged_in", True))
    if "passenger" in params:
        passed = passed and any(
            str(passenger["name"]) == str(params["passenger"])
            and str(passenger["id"]) == str(params["passenger_id"])
            for passenger in app["passengers"]
        )
    return passed, {"auth": app["auth"], "passengers": app["passengers"]}


async def _apply_ebay_state(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    patch: dict[str, Any] = {}
    if "accounts" in params:
        patch["auth"] = {"accounts": copy.deepcopy(params["accounts"])}
    user = copy.deepcopy(state["apps"]["ebay"]["user"])
    user["isLoggedIn"] = bool(params["logged_in"])
    if "username" in params:
        user["username"] = str(params["username"])
    patch["user"] = user
    if "cart" in params:
        patch["cartItems"] = copy.deepcopy(params["cart"])
    if "saved_address" in params:
        patch["savedAddress"] = str(params["saved_address"])
    await _set_state(
        env,
        prepare_app_state_with_patch("ebay", state["apps"]["ebay"], patch),
    )


async def _verify_ebay_state(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    app = after["apps"]["ebay"]
    passed = bool(app["user"]["isLoggedIn"]) == bool(params["logged_in"])
    if "username" in params:
        passed = passed and str(app["user"]["username"]) == str(params["username"])
    if "accounts" in params:
        passed = passed and app["auth"]["accounts"] == params["accounts"]
    if "cart" in params:
        passed = passed and app["cartItems"] == params["cart"]
    if "saved_address" in params:
        passed = passed and str(app["savedAddress"]) == str(params["saved_address"])
    return passed, {
        "user": app["user"],
        "auth": app["auth"],
        "cartItems": app.get("cartItems"),
        "savedAddress": app.get("savedAddress"),
    }


async def _apply_tencent_meeting(
    env: Any, state: dict[str, Any], step_id: str, params: dict[str, Any],
) -> None:
    from bench_env.adv_task0.app import prepare_app_state_with_patch

    meetings = list(state["apps"]["tencent_meeting"]["scheduledMeetings"])
    meeting_id = str(params["meeting_id"]).replace("-", "").replace(" ", "")
    meetings.append({
        "id": f"prep_tm_{_stable_id(step_id)}",
        "meetingId": meeting_id,
        "title": str(params["title"]),
        "note": "",
        "startTime": 1773619200000,
        "duration": 60,
        "timezone": "Asia/Shanghai",
        "repeatType": "none",
        "hostId": str(params["host"]),
        "invitees": [],
        "settings": {},
        "status": "pending",
        "createdAt": 1773619200000,
    })
    await _set_state(
        env,
        prepare_app_state_with_patch(
            "tencent_meeting",
            state["apps"]["tencent_meeting"],
            {"scheduledMeetings": meetings},
        ),
    )


async def _verify_tencent_meeting(
    env: Any,
    before: dict[str, Any],
    after: dict[str, Any],
    step_id: str,
    params: dict[str, Any],
) -> tuple[bool, Any]:
    item_id = f"prep_tm_{_stable_id(step_id)}"
    expected_meeting_id = str(params["meeting_id"]).replace("-", "").replace(" ", "")
    matches = [
        meeting
        for meeting in after["apps"]["tencent_meeting"]["scheduledMeetings"]
        if str(meeting["id"]) == item_id
        and str(meeting["meetingId"]) == expected_meeting_id
        and str(meeting["title"]) == str(params["title"])
        and str(meeting["hostId"]) == str(params["host"])
    ]
    return len(matches) == 1, matches


def _fixed_paths(*paths: str) -> AllowedPathsFn:
    return lambda app, params: tuple(paths)


def _app_path(app: str, params: dict[str, Any]) -> tuple[str, ...]:
    return ("os",) if app == "os" else (f"apps.{app}",)


def _settings_path(app: str, params: dict[str, Any]) -> tuple[str, ...]:
    return (canonical_state_path(str(params["key"])),)


_CONTRACTS: dict[str, PrepareActionContract] = {}


def _register(
    action: str,
    apps: tuple[str, ...],
    required: tuple[str, ...],
    optional: tuple[str, ...],
    apply: ApplyFn,
    verify: VerifyFn,
    allowed_paths: AllowedPathsFn,
) -> None:
    _CONTRACTS[action] = PrepareActionContract(
        action=action,
        apps=frozenset(apps),
        required_params=frozenset(required),
        optional_params=frozenset(optional),
        apply=apply,
        verify=verify,
        allowed_paths=allowed_paths,
    )


_register(
    "contacts_add", ("contacts",), ("name", "phone"), ("company", "notes"),
    _apply_contacts_add, _verify_contacts_add,
    _fixed_paths("os.providers.contacts"),
)
_register(
    "wechat_incoming", ("wechat",), ("contact_name", "content"), (),
    _apply_wechat_incoming, _verify_wechat_incoming, _fixed_paths("apps.wechat"),
)
_register(
    "sms_incoming", ("sms",), ("sender_name", "sender_phone", "content"), (),
    _apply_sms_incoming, _verify_sms_incoming, _fixed_paths("os.providers.sms"),
)
_register(
    "alipay_incoming", ("alipay",), ("contact_name", "content"), (),
    _apply_alipay_incoming, _verify_alipay_incoming, _fixed_paths("apps.alipay"),
)
_register(
    "mail_incoming", ("mail",), ("sender", "subject", "body"), ("time",),
    _apply_mail_incoming, _verify_mail_incoming, _fixed_paths("os.providers.mail"),
)
_register(
    "mail_draft", ("mail",), ("subject", "recipient", "body", "unsent"), (),
    _apply_mail_draft, _verify_mail_draft, _fixed_paths("os.providers.mail"),
)
_register(
    "clipboard_set", ("os",), ("text",), (),
    _apply_clipboard_set, _verify_clipboard_set, _fixed_paths("os.clipboard"),
)
_register(
    "file_create", ("file_manager",), ("path", "content"), (),
    _apply_file_create, _verify_file_create, _fixed_paths("os.fileSystem"),
)
_register(
    "gallery_album", ("gallery",), ("album_name", "photos"), (),
    _apply_gallery_album, _verify_gallery_album, _fixed_paths("os.fileSystem"),
)
_register(
    "note_create", ("notes",), ("title", "content"), (),
    _apply_note_create, _verify_note_create, _fixed_paths("apps.notes"),
)
_register(
    "redbook_note", ("redbook",), ("author", "title", "content"), (),
    _apply_redbook_note, _verify_redbook_note, _fixed_paths("apps.redbook"),
)
_register(
    "x_post_account", ("x",), (), ("username", "display_name"),
    _apply_x_post_account, _verify_x_post_account, _fixed_paths("apps.x"),
)
_register(
    "app_state_patch",
    (
        "alipay", "bilibili", "browser", "calendar", "ebay", "file_manager",
        "gallery", "mail", "map", "notes", "railway12306", "redbook",
        "settings", "sms", "spotify", "tencent_meeting", "wechat",
        "wechat_reading", "x", "os",
    ),
    ("patch",), (), _apply_app_state_patch, _verify_app_state_patch, _app_path,
)
_register(
    "settings_patch", ("settings",), ("key", "value"), (),
    _apply_settings_patch, _verify_settings_patch, _settings_path,
)
_register(
    "calendar_event", ("calendar",), ("title", "date", "notes"), (),
    _apply_calendar_event, _verify_calendar_event, _fixed_paths("apps.calendar"),
)
_register(
    "railway12306_login",
    ("railway12306",), (), ("passenger", "passenger_id", "is_logged_in"),
    _apply_railway_login, _verify_railway_login, _fixed_paths("apps.railway12306"),
)
_register(
    "ebay_state",
    ("ebay",), ("logged_in",),
    ("accounts", "cart", "username", "saved_address"),
    _apply_ebay_state, _verify_ebay_state, _fixed_paths("apps.ebay"),
)
_register(
    "tencent_meeting", ("tencent_meeting",), ("host", "title", "meeting_id"), (),
    _apply_tencent_meeting, _verify_tencent_meeting,
    _fixed_paths("apps.tencent_meeting"),
)


def prepare_action_names() -> tuple[str, ...]:
    """Return the stable action vocabulary in sorted order."""
    return tuple(sorted(_CONTRACTS))


def validate_prepare_plan(plan: Any, *, task_id: str = "") -> PreparePlan:
    """Validate and deep-copy one canonical ``action/app/params`` plan."""
    if not isinstance(plan, list):
        raise PreparePlanError(f"{task_id}: 前置准备 must be a list")
    normalized: PreparePlan = []
    for index, raw in enumerate(plan, start=1):
        prefix = f"{task_id}: 前置准备[{index}]"
        if not isinstance(raw, dict):
            raise PreparePlanError(f"{prefix} must be an object")
        if set(raw) != {"action", "app", "params"}:
            raise PreparePlanError(
                f"{prefix} keys must be exactly action/app/params, got {sorted(raw)}"
            )
        action = str(raw["action"])
        app = str(raw["app"])
        params = raw["params"]
        if action not in _CONTRACTS:
            raise PreparePlanError(f"{prefix}: unknown action {action!r}")
        contract = _CONTRACTS[action]
        if app not in contract.apps:
            raise PreparePlanError(
                f"{prefix}: action {action!r} does not support app {app!r}; "
                f"expected one of {sorted(contract.apps)}"
            )
        if not isinstance(params, dict):
            raise PreparePlanError(f"{prefix}.params must be an object")
        keys = set(params)
        missing = contract.required_params - keys
        unknown = keys - contract.required_params - contract.optional_params
        if missing:
            raise PreparePlanError(f"{prefix}.params missing {sorted(missing)}")
        if unknown:
            raise PreparePlanError(f"{prefix}.params has unknown keys {sorted(unknown)}")
        if action == "gallery_album":
            photos = params["photos"]
            if not isinstance(photos, list) or not photos:
                raise PreparePlanError(f"{prefix}.params.photos must be a non-empty list")
            for photo in photos:
                if not isinstance(photo, dict) or set(photo) != {"name"}:
                    raise PreparePlanError(
                        f"{prefix}.params.photos entries must be {{'name': ...}}"
                    )
        if action == "app_state_patch" and not isinstance(params["patch"], dict):
            raise PreparePlanError(f"{prefix}.params.patch must be an object")
        if action == "railway12306_login":
            passenger_keys = {"passenger", "passenger_id"}
            if bool(keys & passenger_keys) and not passenger_keys <= keys:
                raise PreparePlanError(
                    f"{prefix}.params passenger and passenger_id must appear together"
                )
        normalized.append(copy.deepcopy(raw))
    return normalized


async def execute_prepare_plan(
    env: Any,
    plan: PreparePlan,
    *,
    task_id: str,
    required_apps: list[str] | None = None,
) -> PreparePlanReport:
    """Execute and prove every preparation step, failing closed on any mismatch."""
    normalized = validate_prepare_plan(plan, task_id=task_id)
    required = set(required_apps or [])
    required.update(
        step["app"]
        for step in normalized
        if step["app"] not in {"os", "contacts"}
    )
    requested_apps = sorted(required) or None
    state = await env.get_state(required_apps=requested_apps)
    reports: list[PrepareStepReport] = []
    for index, step in enumerate(normalized, start=1):
        action = str(step["action"])
        app = str(step["app"])
        params = step["params"]
        contract = _CONTRACTS[action]
        step_id = f"{task_id}|{index}|{app}|{action}"
        before = copy.deepcopy(state)
        try:
            await contract.apply(env, before, step_id, params)
            after = await env.get_state(required_apps=requested_apps)
            passed, evidence = await contract.verify(
                env, before, after, step_id, params,
            )
        except Exception as exc:
            raise PreparePlanError(
                f"{task_id}: preparation step {index} ({action}/{app}) failed "
                f"during apply/verify: {type(exc).__name__}: {exc}"
            ) from exc
        changed = _changed_paths(before, after)
        allowed = contract.allowed_paths(app, params)
        unexpected = [path for path in changed if not _path_allowed(path, allowed)]
        report = PrepareStepReport(
            task_id=task_id,
            index=index,
            action=action,
            app=app,
            passed=bool(passed) and not unexpected,
            changed_paths=changed,
            allowed_paths=list(allowed),
            evidence={
                "postcondition": evidence,
                "unexpected_paths": unexpected,
            },
        )
        reports.append(report)
        if not report.passed:
            raise PreparePlanError(
                f"{task_id}: preparation step {index} ({action}/{app}) failed: "
                f"{report.to_dict()}"
            )
        state = after
    return PreparePlanReport(task_id=task_id, success=True, steps=reports)


def _deep_merge_state(base: dict[str, Any], patch: dict[str, Any]) -> None:
    """与 MobileGymEnv.set_state(deep=True) 一致的纯内存合并。"""
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge_state(base[key], value)
        else:
            base[key] = copy.deepcopy(value)


class _SnapshotPage:
    """为统一执行器提供 clipboard/time/FileSystem 的最小 page.evaluate。"""

    def __init__(self, env: "SnapshotPreparationEnv") -> None:
        self.env = env

    async def evaluate(self, script: str, arg: Any) -> None:
        if isinstance(arg, str):
            self.env.state["os"]["clipboard"] = {
                "type": "text",
                "content": arg,
                "timestamp": 1773619200000,
                "source": "task_prep",
            }
            return
        if isinstance(arg, dict) and "iso_date" in arg:
            value = str(arg["iso_date"])
            timestamp = int(
                datetime.datetime.fromisoformat(f"{value}T12:00:00").timestamp() * 1000
            )
            self.env.state["os"]["time"] = {
                "mode": "simulated",
                "timestamp": timestamp,
                "iso_date": value,
            }
            return
        raw = base64.b64decode(arg["encoded"])
        path = str(arg["path"])
        file_system = self.env.state["os"].setdefault("fileSystem", {})
        nodes = file_system.setdefault("nodes", [])
        if isinstance(nodes, dict):
            nodes = [
                {"path": node_path, **(node if isinstance(node, dict) else {})}
                for node_path, node in nodes.items()
            ]
            file_system["nodes"] = nodes
        nodes[:] = [node for node in nodes if str(node.get("path")) != path]
        nodes.append({
            "id": f"snapshot_file_{hashlib.sha256(path.encode()).hexdigest()[:16]}",
            "name": path.rsplit("/", 1)[-1],
            "type": "file",
            "parentId": None,
            "path": path,
            "size": len(raw),
            "mimeType": str(arg["mimeType"]),
            "createdAt": 1773619200000,
            "modifiedAt": 1773619200000,
            "storage": "memory",
            "contentText": (
                raw.decode("utf-8")
                if str(arg["mimeType"]).startswith("text/")
                else None
            ),
        })


class SnapshotPreparationEnv:
    """对真实状态快照执行同一套 prepare contract，不接触浏览器或 defaults。"""

    def __init__(self, baseline: dict[str, Any]) -> None:
        self.state = copy.deepcopy(baseline)
        self.page = _SnapshotPage(self)

    async def get_state(
        self, *, required_apps: list[str] | None = None,
    ) -> dict[str, Any]:
        if required_apps:
            missing = sorted(set(required_apps) - set(self.state.get("apps", {})))
            if missing:
                raise KeyError(f"missing required app stores: {missing}")
        return copy.deepcopy(self.state)

    async def set_state(
        self, patch: dict[str, Any], *, deep: bool = True, reload: bool = False,
    ) -> None:
        if not deep:
            raise ValueError("SnapshotPreparationEnv only supports deep merge")
        _deep_merge_state(self.state, patch)


async def prepare_state_snapshot(
    baseline: dict[str, Any],
    plan: PreparePlan,
    *,
    task_id: str,
    required_apps: list[str] | None = None,
) -> tuple[dict[str, Any], PreparePlanReport]:
    """在内存快照上执行并验证正式 prepare contract，供 judge 正反例复用。"""
    env = SnapshotPreparationEnv(baseline)
    report = await execute_prepare_plan(
        env,
        plan,
        task_id=task_id,
        required_apps=required_apps,
    )
    return copy.deepcopy(env.state), report
