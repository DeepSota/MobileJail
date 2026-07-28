#!/usr/bin/env python3
"""Offline structural tests for the MobileJail app-control skill."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


def _load_runtime():
    path = HERE / "mobilejail_apps.py"
    spec = importlib.util.spec_from_file_location("mobilejail_apps", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    module = _load_runtime()
    manifest_ids = set()
    for layer in ("apps", "system"):
        for manifest in (REPO / layer).glob("*/manifest.ts"):
            text = manifest.read_text(encoding="utf-8")
            marker = "id:"
            tail = text.split(marker, 1)[1].lstrip()
            manifest_ids.add(tail[1:].split(tail[0], 1)[0])

    class_ids = set(module.APP_CLASSES)
    assert class_ids == manifest_ids, (
        f"class/manifest mismatch: missing={sorted(manifest_ids-class_ids)}, "
        f"extra={sorted(class_ids-manifest_ids)}"
    )
    assert module._snake_to_camel("send_text") == "sendText"
    assert module._python_name("settings.tempUnit.select.celsius") == "settings_temp_unit_select_celsius"
    assert module._python_name("addPost") == "add_post"
    assert module._changed_paths({"a": 1}, {"a": 2}) == ["a"]
    assert hasattr(module.App, "ui")
    assert hasattr(module.App, "ui_functions")
    assert hasattr(module.App, "route")
    assert hasattr(module.App, "module")
    assert hasattr(module.Sms, "send")
    assert hasattr(module.Mail, "send")
    assert hasattr(module.Mail, "forward")
    assert hasattr(module.Wechat, "send_text")
    assert hasattr(module.Wechat, "send_files")
    assert hasattr(module.X, "publish")
    assert hasattr(module.RedBook, "comment")
    assert hasattr(module.RedBook, "comment_latest")
    assert hasattr(module.RedBook, "publish")
    assert hasattr(module.Settings, "set")
    assert hasattr(module.Settings, "enable_developer_mode")
    assert hasattr(module.FileManager, "delete")
    assert hasattr(module.FileManager, "info")
    assert hasattr(module.Gallery, "share")
    assert hasattr(module.Alipay, "transfer")
    assert hasattr(module.Alipay, "send_text")
    assert hasattr(module.Bilibili, "comment_first")
    assert hasattr(module.Bilibili, "send_files")
    assert hasattr(module.Browser, "search")
    assert hasattr(module.Calendar, "create")
    assert hasattr(module.Contacts, "update_by_name")
    assert hasattr(module.Ebay, "search")
    assert hasattr(module.Notes, "create")
    assert hasattr(module.Railway12306, "search")
    assert hasattr(module.Spotify, "create_playlist")
    assert hasattr(module.TencentMeeting, "join")
    print(f"OK: {len(class_ids)} app classes and semantic wrappers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
