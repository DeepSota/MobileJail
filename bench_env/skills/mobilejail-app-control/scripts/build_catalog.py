#!/usr/bin/env python3
"""Generate the MobileJail app/action inventory used as skill reference."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def _manifest_id(text: str) -> str:
    match = re.search(r"\bid\s*:\s*['\"]([^'\"]+)", text)
    if not match:
        raise ValueError("manifest has no id")
    return match.group(1)


def _balanced_interfaces(text: str) -> list[str]:
    bodies: list[str] = []
    for match in re.finditer(r"interface\s+\w*Actions\s*\{", text):
        start = match.end()
        depth = 1
        index = start
        while index < len(text) and depth:
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
            index += 1
        bodies.append(text[start:index - 1])
    return bodies


def _actions(state_file: Path) -> list[str]:
    if not state_file.exists():
        return []
    text = state_file.read_text(encoding="utf-8")
    names: set[str] = set()
    for body in _balanced_interfaces(text):
        names.update(re.findall(r"^\s{2,4}([A-Za-z_$][\w$]*)(?:\??):\s*\(", body, re.M))
    names.update(re.findall(r"^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", text, re.M))
    return sorted(names)


def build(repo_root: Path) -> str:
    rows: list[tuple[str, str, str, list[str]]] = []
    for layer in ("apps", "system"):
        for directory in sorted((repo_root / layer).iterdir()):
            manifest = directory / "manifest.ts"
            if not directory.is_dir() or not manifest.exists():
                continue
            app_id = _manifest_id(manifest.read_text(encoding="utf-8"))
            rows.append((layer, directory.name, app_id, _actions(directory / "state.ts")))

    lines = [
        "# App capability inventory",
        "",
        "Generated from current `apps/*/manifest.ts`, `system/*/manifest.ts`, and `state.ts`.",
        "Runtime `app.functions()` is authoritative because provider-backed functions may live outside stores.",
        "",
        f"Coverage: {len(rows)} app manifests.",
        "",
        "| Layer | Class source | App ID | Store/module functions |",
        "|---|---|---|---|",
    ]
    for layer, directory, app_id, actions in rows:
        rendered = ", ".join(f"`{name}`" for name in actions) or "No exported/store action found"
        lines.append(f"| `{layer}` | `{directory}` | `{app_id}` | {rendered} |")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    content = build(args.repo_root.resolve())
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
    else:
        print(content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
