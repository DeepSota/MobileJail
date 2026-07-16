#!/usr/bin/env python3
"""parse_prompts.py — normalize a jailbreak prompt file into a JSON manifest.

Usage:
    python Z-Jailbreak_Construction_SKILL/scripts/parse_prompts.py <prompt-file> [--output <path>]
    python Z-Jailbreak_Construction_SKILL/scripts/parse_prompts.py Z-越狱构建/越狱prompt.md
    python Z-Jailbreak_Construction_SKILL/scripts/parse_prompts.py Z-越狱构建/task.json

Default output: Z-Jailbreak_Construction_SKILL/.cache/prompts.json

Accepts Markdown, YAML, or the Chinese-key task JSON used by
Z-越狱构建/task.json.

Exit codes:
    0 — parsed successfully, manifest written
    1 — file not found / unreadable
    2 — schema validation failed (per-entry error list printed to stderr)
    3 — internal error (parser bug)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# App name resolution (keep in sync with references/prompt_schema.md §4)
# ---------------------------------------------------------------------------

APP_NAME_MAP: dict[str, str] = {
    # Chinese names
    "短信": "sms", "微信": "wechat", "支付宝": "alipay", "小红书": "redbook",
    "日历": "calendar", "通讯录": "contacts", "笔记": "notes",
    "微信读书": "wechat_reading", "腾讯会议": "tencent_meeting",
    "天气": "weather", "地图": "map", "文件管理器": "file_manager",
    "时钟": "clock", "铁路": "railway12306", "12306": "railway12306",
    "邮件": "mail",
    # English / canonical (lowercase + mixed)
    "sms": "sms", "wechat": "wechat", "alipay": "alipay", "redbook": "redbook",
    "x": "x", "twitter": "x", "reddit": "reddit", "calendar": "calendar",
    "contacts": "contacts", "notes": "notes", "wechat_reading": "wechat_reading",
    "bilibili": "bilibili", "spotify": "spotify", "railway12306": "railway12306",
    "tencent_meeting": "tencent_meeting", "ebay": "ebay", "weather": "weather",
    "map": "map", "file_manager": "file_manager", "clock": "clock",
    "mail": "mail", "settings": "settings",
}

# Map of resolved app_id -> manifest directory under apps/ or system/.
# Used to validate that the target app exists in the repo.
APP_DIRECTORY_MAP: dict[str, str] = {
    "sms": "system/Sms", "wechat": "apps/Wechat", "alipay": "apps/Alipay",
    "redbook": "apps/RedBook", "x": "apps/X", "reddit": "apps/Reddit",
    "calendar": "system/Calendar", "contacts": "system/Contacts",
    "notes": "system/Notes", "wechat_reading": "apps/WechatReading",
    "bilibili": "apps/Bilibili", "spotify": "apps/Spotify",
    "railway12306": "apps/Railway12306", "tencent_meeting": "apps/TencentMeeting",
    "ebay": "apps/Ebay", "weather": "apps/Weather", "map": "apps/Map",
    "file_manager": "system/FileManager", "clock": "system/Clock",
    "mail": "apps/Mail", "settings": "system/Settings",
}

VALID_RISK_CATEGORIES = {
    "M-COMM", "M-PHIS", "M-FIN", "M-SET", "M-DATA", "M-PRIV",
    "M-ILLEGAL", "M-HAR", "M-HATE", "M-MEDIA", "M-CONT", "M-COPY",
}
VALID_MECHANISMS = {"JAIL-DIRECT", "JAIL-CONFIRM", "JAIL-ROLE", "JAIL-XAPP"}
MECHANISM_ALIASES: dict[str, str] = {
    "直接越狱": "JAIL-DIRECT",
    "跳过确认": "JAIL-CONFIRM",
    "确认绕过": "JAIL-CONFIRM",
    "伪权限角色": "JAIL-ROLE",
    "角色扮演": "JAIL-ROLE",
    "跨应用": "JAIL-XAPP",
    "跨应用任务劫持": "JAIL-XAPP",
}

DIFFICULTY_AUTO_RULES: list[tuple[str, str]] = [
    # (substring in mechanism/target, difficulty)
    ("JAIL-XAPP", "L4"),
    ("JAIL-ROLE", "L3"),
]
DIFFICULTY_DEFAULT = "L2"


# ---------------------------------------------------------------------------
# Markdown parser
# ---------------------------------------------------------------------------

PROMPT_HEADER_RE = re.compile(
    r"^##\s*Prompt\s+\d+\s*[（(]\s*([^)）]+)\s*[)）]\s*$"
)

# Header tag patterns: "COMM-01", "PHIS-05", "FIN-02", "SET-06", "DATA-02",
# or just "PRIV". The first slash-separated field is the risk tag.
RISK_TAG_RE = re.compile(
    r"^\s*(?P<tag>COMM|PHIS|FIN|SET|DATA|PRIV)(?:-\d+)?\b",
    re.IGNORECASE,
)

KEY_LINE_RE = re.compile(
    r"^\*\*(?P<key>[^*：:]+)\*\*\s*[:：]\s*(?P<value>.+?)\s*$"
)


def _split_by_pipe(s: str) -> list[str]:
    return [chunk.strip() for chunk in s.split("|") if chunk.strip()]


def _parse_header_tag(tag_field: str) -> tuple[str | None, list[str]]:
    """Extract (risk_category, mechanisms) from the header tag field.

    Header format: "COMM-01 / JAIL-DIRECT + JAIL-CONFIRM" — risk tag before
    the first slash, mechanism after, with '+' or '/' separating mechanisms.
    Returns (None, [...]) if the risk tag is missing — caller validates.
    """
    parts = [p.strip() for p in tag_field.split("/")]
    risk_cat: str | None = None
    if parts:
        m = RISK_TAG_RE.match(parts[0])
        if m:
            tag = m.group("tag").upper()
            risk_cat = f"M-{tag}" if not tag.startswith("M-") else tag
    # Mechanisms can be in any part after the first, joined by '+' or spaces.
    mech_str = " ".join(parts[1:]) if len(parts) > 1 else ""
    mech_str = mech_str.replace("+", " ").replace("/", " ")
    raw_mechs = [m.upper() for m in mech_str.split() if m]
    resolved: list[str] = []
    for m in raw_mechs:
        if m in VALID_MECHANISMS:
            resolved.append(m)
        elif m in MECHANISM_ALIASES:
            resolved.append(MECHANISM_ALIASES[m])
        else:
            # Try alias lookup case-insensitively for Chinese aliases that
            # may not have been normalized to upper-case yet.
            for k, v in MECHANISM_ALIASES.items():
                if m == k:
                    resolved.append(v)
                    break
    return risk_cat, resolved


def parse_markdown(text: str) -> list[dict[str, Any]]:
    """Parse a Markdown prompt file → list of manifest entries."""
    entries: list[dict[str, Any]] = []
    lines = text.splitlines()
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        header_match = PROMPT_HEADER_RE.match(line.strip())
        if not header_match:
            i += 1
            continue

        tag_field = header_match.group(1)
        risk_cat_from_header, mechs_from_header = _parse_header_tag(tag_field)

        # Collect metadata lines and the blockquote prompt until next ## header
        i += 1
        meta: dict[str, str] = {}
        prompt_lines: list[str] = []
        in_blockquote = False
        while i < n:
            cur = lines[i]
            stripped = cur.strip()
            if stripped.startswith("## "):
                break
            if stripped.startswith("---"):
                break
            if stripped.startswith("> "):
                prompt_lines.append(stripped[2:])
                in_blockquote = True
                i += 1
                continue
            if stripped.startswith(">"):
                prompt_lines.append(stripped[1:].lstrip())
                in_blockquote = True
                i += 1
                continue
            # Allow continuation of blockquote across blank lines? No — stop
            # collecting prompt at the first non-blockquote non-blank line.
            if in_blockquote and stripped == "":
                # blank line inside the prompt block
                i += 1
                continue
            if in_blockquote:
                # We've already collected prompt lines; treat subsequent
                # lines as further metadata (e.g. **验证方式**: ...)
                in_blockquote = False

            km = KEY_LINE_RE.match(stripped)
            if km:
                key = km.group("key").strip().lower()
                value = km.group("value").strip()
                meta[key] = value
            i += 1

        prompt_text = "\n".join(prompt_lines).strip()
        entries.append({
            "_risk_cat_from_header": risk_cat_from_header,
            "_mechs_from_header": mechs_from_header,
            "_meta": meta,
            "_prompt": prompt_text,
        })

    # Normalize each entry
    normalized = []
    for raw in entries:
        meta = raw["_meta"]
        # target_app: may be in **目标 App**: 短信 or in the "| **目标 App**: 短信"
        # multi-key line. Check explicit "目标 app" / "app" / "target_app" first.
        target_app_raw = (
            meta.get("目标 app")
            or meta.get("目标应用")
            or meta.get("target_app")
            or meta.get("app")
            or ""
        )
        # If empty, try parsing from a pipeline-separated first line:
        # "**任务类**: `T0001_X` | **难度**: L1 | **目标 App**: 短信"
        if not target_app_raw:
            task_class_line = meta.get("任务类") or meta.get("task_class") or meta.get("class")
            if task_class_line and "|" in task_class_line:
                for chunk in _split_by_pipe(task_class_line):
                    cm = KEY_LINE_RE.match(chunk)
                    if cm and cm.group("key").strip().lower() in ("目标 app", "目标应用", "app", "target_app"):
                        target_app_raw = cm.group("value").strip()
                    elif cm and cm.group("key").strip().lower() in ("任务类", "task_class", "class"):
                        meta["任务类"] = cm.group("value").strip()
                    elif cm and cm.group("key").strip().lower() in ("难度", "difficulty"):
                        meta["难度"] = cm.group("value").strip()

        target_app_raw = target_app_raw.strip().strip("`").strip()

        # difficulty
        difficulty = (meta.get("难度") or meta.get("difficulty") or "").strip().upper()
        if difficulty not in {"L1", "L2", "L3", "L4"}:
            difficulty = ""

        # risk_category: prefer explicit field, fall back to header tag
        risk_cat = (meta.get("风险类别") or meta.get("risk_category") or raw.get("_risk_cat_from_header") or "").strip().upper()
        if risk_cat and not risk_cat.startswith("M-"):
            risk_cat = f"M-{risk_cat}" if not risk_cat.startswith("M") else risk_cat

        # mechanism: prefer explicit field, fall back to header
        mech_raw = meta.get("机制") or meta.get("mechanism") or ""
        mechs: list[str] = []
        if mech_raw:
            for tok in re.split(r"[\s+/]+", mech_raw):
                tok = tok.strip()
                if not tok:
                    continue
                if tok.upper() in VALID_MECHANISMS:
                    mechs.append(tok.upper())
                elif tok in MECHANISM_ALIASES:
                    mechs.append(MECHANISM_ALIASES[tok])
        if not mechs:
            mechs = raw["_mechs_from_header"]

        # prerequisite_data: split on ; or 、
        prereq_raw = (
            meta.get("前置数据")
            or meta.get("prerequisite_data")
            or meta.get("prereq")
            or ""
        )
        prereq = [s.strip() for s in re.split(r"[;；]", prereq_raw) if s.strip()]
        # Also strip surrounding backticks / extra quoted text

        task_class_raw = (
            meta.get("任务类")
            or meta.get("task_class")
            or meta.get("class")
            or ""
        )
        # The value may contain pipe-separated extra metadata from a multi-key
        # line like  `T0001_X` | **难度**: L1 | **目标 App**: 短信
        # Keep only the chunk before the first pipe.
        if "|" in task_class_raw:
            task_class_raw = task_class_raw.split("|", 1)[0]
        task_class_clean = task_class_raw.strip().strip("`").strip()

        normalized.append({
            "task_class": task_class_clean or None,
            "difficulty": difficulty or None,
            "target_app_raw": target_app_raw,
            "risk_category": risk_cat or None,
            "mechanism": mechs,
            "risk_description": (meta.get("对应风险") or meta.get("风险") or meta.get("risk_description") or meta.get("risk") or "").strip(),
            "prerequisite_data": prereq,
            "prompt": raw["_prompt"],
            "check_method_hint": (meta.get("验证方式") or meta.get("verification") or meta.get("check_method") or "").strip(),
        })

    return normalized


# ---------------------------------------------------------------------------
# YAML parser (uses PyYAML if available; otherwise rejects YAML input)
# ---------------------------------------------------------------------------

def parse_yaml(text: str) -> list[dict[str, Any]]:
    try:
        import yaml  # type: ignore
    except ImportError as e:
        raise SystemExit(
            "YAML input requires PyYAML. Install it (`pip install pyyaml`) "
            "or convert the file to Markdown."
        ) from e
    data = yaml.safe_load(text)
    if not isinstance(data, list):
        raise SystemExit("YAML root must be a list of prompt entries.")
    out: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            raise SystemExit(f"YAML entry must be a dict, got {type(item)}")
        out.append({
            "task_class": item.get("task_class"),
            "difficulty": item.get("difficulty"),
            "target_app_raw": str(item.get("target_app") or item.get("app") or ""),
            "risk_category": (item.get("risk_category") or "").upper() or None,
            "mechanism": [
                m.upper() if m.upper() in VALID_MECHANISMS else MECHANISM_ALIASES.get(m, m.upper())
                for m in (item.get("mechanism") or [])
            ],
            "risk_description": item.get("risk_description") or "",
            "prerequisite_data": list(item.get("prerequisite_data") or []),
            "prompt": item.get("prompt") or "",
            "check_method_hint": item.get("check_method_hint") or "",
        })
    return out


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _resolve_app_token(token: str) -> str | None:
    """Resolve a single app-name token (after stripping aliases/parentheses).

    Handles:
      - "X (Twitter)"  → "x"
      - "Twitter" / "twitter" → "x"
      - "支付宝" → "alipay"
      - any direct key in APP_NAME_MAP
    """
    # Strip parentheticals like "(Twitter)"
    cleaned = re.sub(r"\s*\([^)]*\)\s*", "", token).strip()
    # Strip trailing punctuation
    cleaned = cleaned.strip("：:,，。.`\"'").strip()
    if not cleaned:
        return None
    # Direct lookup (case-insensitive)
    for key in (cleaned, cleaned.lower(), cleaned.upper()):
        if key in APP_NAME_MAP:
            return APP_NAME_MAP[key]
    # Try matching just the first word (for "X (Twitter)" after paren strip → "X")
    first_word = re.split(r"[\s/]", cleaned, 1)[0]
    for key in (first_word, first_word.lower(), first_word.upper()):
        if key in APP_NAME_MAP:
            return APP_NAME_MAP[key]
    return None


def _resolve_app(raw_name: str, repo_root: Path) -> tuple[list[str], list[str]]:
    """Resolve a raw app name field → (resolved_app_ids, error_messages).

    Handles:
      - Single-app names: "短信" / "微信" / "X (Twitter)" / "Alipay"
      - Pipe- or plus-separated multi-app names: "支付宝 + 微信" / "Alipay + Wechat"
        (returned as a list of distinct app ids)
    """
    if not raw_name:
        return [], ["empty app name"]
    # Split on +, |, /, " 和 ", ", "
    tokens = re.split(r"\s*[\+/|，,]\s*|\s+和\s+", raw_name)
    tokens = [t.strip() for t in tokens if t.strip()]
    if not tokens:
        return [], [f"could not parse app name: {raw_name!r}"]

    app_ids: list[str] = []
    errors: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        app_id = _resolve_app_token(tok)
        if app_id is None:
            errors.append(f"unrecognized app name: {tok!r}")
            continue
        if app_id in seen:
            continue  # de-duplicate "支付宝 + 支付宝"
        seen.add(app_id)
        # Verify manifest
        rel_dir = APP_DIRECTORY_MAP.get(app_id)
        if rel_dir is None:
            errors.append(f"app_id {app_id!r} has no manifest directory mapping")
            continue
        manifest_path = repo_root / rel_dir / "manifest.ts"
        if not manifest_path.exists():
            errors.append(f"missing manifest for {app_id}: {manifest_path}")
            continue
        app_ids.append(app_id)
    return app_ids, errors


def _extract_entities_from_prompt(prompt: str) -> list[str]:
    """Auto-extract named entities the prompt references, as a fallback when
    `**前置数据**` is not explicitly listed.

    Extracts:
      - Phone numbers: `+86 13800138000` or `13800138000`
      - Email addresses
      - WeChat wxids (heuristic: `wxid_*`, `xiaohong_123`, etc. — kept conservative)
      - URLs (phishing links, group invites)
      - Quoted Chinese names: 「张三」, 「Boss」, 「海边小橘子」
    """
    entities: list[str] = []
    # Phone numbers — match `+86 13800138000` or bare 11-digit Chinese mobile
    for m in re.finditer(r"\+?86\s?\d{11}|1[3-9]\d{9}", prompt):
        entities.append(m.group(0).strip())
    # Email addresses
    for m in re.finditer(r"[\w.+-]+@[\w.-]+\.\w+", prompt):
        entities.append(m.group(0))
    # URLs
    for m in re.finditer(r"https?://\S+|t\.me/\S+", prompt):
        entities.append(m.group(0))
    # Quoted Chinese names: 「...」 and quoted ASCII: "waylybaye"
    for m in re.finditer(r"「([^」]+)」", prompt):
        entities.append(m.group(1))
    # Bracketed identifiers like (x1dubbu13) or (wxid_xxx)
    for m in re.finditer(r"\(([a-zA-Z0-9_]{3,40})\)", prompt):
        entities.append(m.group(1))
    # De-duplicate while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for e in entities:
        if e in seen:
            continue
        seen.add(e)
        out.append(e)
    return out


def validate_entries(entries: list[dict[str, Any]], repo_root: Path) -> list[str]:
    """Validate parsed entries. Returns a list of error strings (empty = OK).

    `prerequisite_data` is OPTIONAL — if not explicitly listed in the prompt
    file, this function auto-extracts entities from the prompt text and emits
    them via the `_extracted_prereq` field. Callers can then prompt the user
    to confirm / extend the extracted list before codegen.
    """
    errors: list[str] = []
    for idx, e in enumerate(entries, start=1):
        where = f"entry #{idx}"
        # target_app
        if not e.get("target_app_raw"):
            errors.append(f"{where}: missing '目标 App'")
            continue
        app_ids, app_errors = _resolve_app(e["target_app_raw"], repo_root)
        if app_errors:
            for err in app_errors:
                errors.append(f"{where}: {err}")
        e["_resolved_app_ids"] = app_ids  # may be partial
        # risk_category
        rc = e.get("risk_category")
        if not rc:
            errors.append(f"{where}: missing '风险类别'")
        elif rc not in VALID_RISK_CATEGORIES:
            errors.append(f"{where}: invalid risk_category {rc!r} (must be one of {sorted(VALID_RISK_CATEGORIES)})")
        # mechanism
        mechs = e.get("mechanism") or []
        if not mechs:
            errors.append(f"{where}: missing '机制' (mechanism)")
        else:
            unknown = [m for m in mechs if m not in VALID_MECHANISMS]
            if unknown:
                errors.append(f"{where}: invalid mechanism(s) {unknown}")
        # risk_description
        if len(e.get("risk_description") or "") < 4:
            errors.append(f"{where}: '对应风险' too short (need >= 4 chars)")
        # prerequisite_data — OPTIONAL, auto-extracted as fallback. If neither
        # explicit nor extractable, fall back to the resolved app ids themselves
        # (so the entry is anchored at minimum to "defaults.json of <app>").
        if not e.get("prerequisite_data"):
            extracted = _extract_entities_from_prompt(e.get("prompt") or "")
            e["_extracted_prereq"] = extracted
            if not extracted:
                # Drop to a warning rather than an error: anchors like "Boss"
                # or "所有事件" are valid simulator-targeted references that
                # just don't have a phone number / wxid to extract.
                e["_warn_no_extracted_prereq"] = True
                # Fall back to the resolved app ids so downstream codegen has
                # something to anchor against.
                e["_extracted_prereq"] = [f"apps[{aid}].defaults.json" for aid in (e.get("_resolved_app_ids") or [])]
        # prompt
        if len(e.get("prompt") or "") < 10:
            errors.append(f"{where}: prompt too short (need >= 10 chars)")
    return errors


# ---------------------------------------------------------------------------
# Difficulty auto-assignment + task_class auto-assignment
# ---------------------------------------------------------------------------

def auto_assign_difficulty(entry: dict[str, Any]) -> str:
    if entry.get("difficulty") in {"L1", "L2", "L3", "L4"}:
        return entry["difficulty"]
    prompt = (entry.get("prompt") or "").lower()
    mechs = entry.get("mechanism") or []
    if "JAIL-XAPP" in mechs:
        return "L4"
    if "JAIL-ROLE" in mechs:
        return "L3"
    # Heuristics on prompt text
    if any(kw in prompt for kw in ["转账", "transfer", "群发"]):
        return "L2"
    if any(kw in prompt for kw in ["删除", "delete", "卸载", "uninstall"]):
        return "L1"
    if any(kw in prompt for kw in ["密码", "password", "隐私", "privacy", "设置"]):
        return "L3"
    return DIFFICULTY_DEFAULT


def auto_assign_task_class(entries: list[dict[str, Any]], adv_task_init_path: Path) -> None:
    """If an entry lacks task_class, assign T<NNNN>_<Verb><Object> from the prompt."""
    # Find current max number used
    existing_max = 0
    if adv_task_init_path.exists():
        text = adv_task_init_path.read_text(encoding="utf-8")
        for m in re.finditer(r'"\s*(T\d{4})_', text):
            num = int(m.group(1)[1:])
            if num > existing_max:
                existing_max = num

    next_num = existing_max + 1
    for e in entries:
        if e.get("task_class"):
            continue
        # Derive verb + object from the prompt's leading verb + target.
        prompt = e.get("prompt") or ""
        # Take first ~6 significant chars, strip whitespace/punctuation
        first_clause = re.split(r"[，,。.！!？?]", prompt, 1)[0]
        # Strip leading "open <app>," if present
        first_clause = re.sub(r"^打开[新]?\S+[,]?[，,]?\s*", "", first_clause)
        # Compress to a slug: remove whitespace, take up to 12 chars
        slug_chars = [c for c in first_clause if c.isalnum() or c == "_"]
        slug = "".join(slug_chars)[:14]
        if not slug:
            slug = "Task"
        # PascalCase-ish
        slug = slug[0].upper() + slug[1:]
        e["task_class"] = f"T{next_num:04d}_{slug}"
        next_num += 1


def auto_scope(entry: dict[str, Any]) -> str:
    """Pick scope based on resolved app count."""
    app_ids = entry.get("_resolved_app_ids") or []
    return "S2" if len(app_ids) >= 2 else "S1"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a jailbreak prompt file → JSON manifest.")
    parser.add_argument("input", type=Path, help="Path to the prompt file (Markdown or YAML)")
    parser.add_argument("--output", "-o", type=Path, default=None, help="Output JSON path (default: Z-Jailbreak_Construction_SKILL/.cache/prompts.json)")
    parser.add_argument("--repo-root", type=Path, default=None, help="Repo root (default: auto-detect from this script's location)")
    args = parser.parse_args()

    repo_root = args.repo_root or (Path(__file__).resolve().parents[2])
    input_path: Path = args.input
    if not input_path.exists():
        print(f"ERROR: input file not found: {input_path}", file=sys.stderr)
        return 1

    text = input_path.read_text(encoding="utf-8")
    if input_path.suffix.lower() == ".json":
        try:
            from build_from_task_json import manifest_entry, normalize_task_json
            specs = normalize_task_json(input_path)
        except Exception as exc:
            print(f"ERROR: failed to parse task JSON: {exc}", file=sys.stderr)
            return 2

        serializable = [manifest_entry(spec) for spec in specs]
        output_path = args.output or (Path(__file__).resolve().parents[1] / ".cache" / "prompts.json")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(serializable, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"OK: parsed {len(serializable)} JSON task entries → {output_path}")
        by_app: dict[str, int] = {}
        for entry in serializable:
            for app_id in entry.get("resolved_app_ids") or []:
                by_app[app_id] = by_app.get(app_id, 0) + 1
        print(f"  by app: {by_app}")
        return 0

    if input_path.suffix.lower() in {".yaml", ".yml"}:
        entries = parse_yaml(text)
    else:
        entries = parse_markdown(text)

    if not entries:
        print("ERROR: no prompt entries found in input.", file=sys.stderr)
        return 2

    errors = validate_entries(entries, repo_root)
    if errors:
        print(f"ERROR: {len(errors)} validation error(s) in {len(entries)} entries:", file=sys.stderr)
        for err in errors[:30]:
            print(f"  - {err}", file=sys.stderr)
        if len(errors) > 30:
            print(f"  ... and {len(errors) - 30} more", file=sys.stderr)
        return 2

    # Auto-assign difficulty + scope + task_class
    for e in entries:
        e["difficulty"] = auto_assign_difficulty(e)
        e["_auto_scope"] = auto_scope(e)
    adv_task_init = repo_root / "bench_env" / "adv_task" / "__init__.py"
    auto_assign_task_class(entries, adv_task_init)

    # Serialize and clean up internal keys
    serializable = []
    for e in entries:
        s = {k: v for k, v in e.items() if not k.startswith("_")}
        s["resolved_app_ids"] = e.get("_resolved_app_ids") or []
        s["scope"] = e.get("_auto_scope") or "S1"
        if e.get("_extracted_prereq"):
            s["extracted_prerequisite_data"] = e["_extracted_prereq"]
        serializable.append(s)

    output_path = args.output or (Path(__file__).resolve().parents[1] / ".cache" / "prompts.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"OK: parsed {len(serializable)} entries → {output_path}")
    # Print a short summary
    by_cat: dict[str, int] = {}
    by_diff: dict[str, int] = {}
    by_app: dict[str, int] = {}
    for e in serializable:
        by_cat[e.get("risk_category") or "?"] = by_cat.get(e.get("risk_category") or "?", 0) + 1
        by_diff[e["difficulty"]] = by_diff.get(e["difficulty"], 0) + 1
        for aid in e.get("resolved_app_ids") or []:
            by_app[aid] = by_app.get(aid, 0) + 1
    print(f"  by category: {by_cat}")
    print(f"  by difficulty: {by_diff}")
    print(f"  by app: {by_app}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
