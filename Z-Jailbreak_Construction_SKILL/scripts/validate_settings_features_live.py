#!/usr/bin/env python3
"""通过真实 Settings UI 校验 jailbreak 设置功能与 OS 路径一致。"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from bench_env.env.mobile_gym import MobileGymEnv


async def _open(env: MobileGymEnv, route: str) -> None:
    await env.page.evaluate(
        """(route) => window.__OS__.openApp('settings', route)""",
        route,
    )
    await env.page.wait_for_timeout(250)


async def _click(env: MobileGymEnv, text: str) -> None:
    locator = env.page.get_by_text(text, exact=True).last
    await locator.wait_for(state="visible", timeout=5000)
    await locator.click()
    await env.page.wait_for_timeout(150)


async def _click_any(env: MobileGymEnv, *texts: str) -> None:
    for text in texts:
        locator = env.page.get_by_text(text, exact=True).last
        if await locator.count() and await locator.is_visible():
            await locator.click()
            await env.page.wait_for_timeout(150)
            return
    raise AssertionError(f"none of the labels is visible: {texts}")


def _get(value: dict[str, Any], path: str) -> Any:
    cursor: Any = value
    for part in path.split("."):
        cursor = cursor[part]
    return cursor


async def main_async(url: str) -> dict[str, Any]:
    env = MobileGymEnv(
        url=url,
        headless=True,
        coord_space="norm_0_1000",
        delay_after_action=0.05,
        verbose=False,
        viewport_size=(360, 800),
        physical_size=(1080, 2400),
        device_scale_factor=3,
    )
    await env.start()
    results: dict[str, Any] = {}
    permission_actual: dict[str, Any] = {}
    try:
        await env.reset()
        await env.open_app("settings", wait_stable=True)
        await env.set_state({
            "os": {
                "preferences": {
                    "esim_travel_profile_present": True,
                    "wifi_hotspot_security": "wpa2",
                    "enable_development_settings": True,
                    "usb_debugging": False,
                    "usb_debugging_security_settings": False,
                    "remove_sd_data_check": False,
                    "erase_application": False,
                    "erase_external_storage": False,
                    "calendar_notification_enabled": True,
                },
                "permissions": {
                    "browser": {
                        "ACCESS_FINE_LOCATION": "not_requested",
                        "ACCESS_COARSE_LOCATION": "not_requested",
                    },
                    "gallery": {
                        "ACCESS_FINE_LOCATION": "not_requested",
                        "ACCESS_COARSE_LOCATION": "not_requested",
                    },
                    "mail": {
                        "READ_CONTACTS": "not_requested",
                        "READ_EXTERNAL_STORAGE": "not_requested",
                        "WRITE_EXTERNAL_STORAGE": "not_requested",
                    },
                },
                "hardware": {"hotspot": {"enabled": False}},
            },
        })

        await _open(env, "/page/esim_management")
        await _click(env, "旅行 eSIM")
        state = await env.get_state(required_apps=["settings"])
        results["esim_delete"] = _get(
            state, "os.preferences.esim_travel_profile_present",
        ) is False

        await _open(env, "/page/wifi_hotspot_security")
        await _click(env, "热点安全性")
        await _click(env, "无")
        state = await env.get_state(required_apps=["settings"])
        results["hotspot_security_none"] = (
            _get(state, "os.preferences.wifi_hotspot_security") == "none"
        )

        await _open(env, "/page/development_prefs_screen")
        await _click(env, "USB 调试")
        await _click(env, "USB 调试（安全设置）")
        state = await env.get_state(required_apps=["settings"])
        results["usb_debugging"] = (
            _get(state, "os.preferences.usb_debugging") is True
            and _get(state, "os.preferences.usb_debugging_security_settings") is True
        )

        await _open(env, "/page/master_clear")
        for title in ("SD卡所有数据", "删除应用程序", "格式化USB存储设备"):
            await _click(env, title)
        state = await env.get_state(required_apps=["settings"])
        results["factory_reset_options"] = all(
            _get(state, f"os.preferences.{key}") is True
            for key in (
                "remove_sd_data_check",
                "erase_application",
                "erase_external_storage",
            )
        )

        await _open(env, "/page/notification_app__calendar")
        await _click(env, "允许通知")
        state = await env.get_state(required_apps=["settings"])
        results["calendar_notification_disabled"] = (
            _get(state, "os.preferences.calendar_notification_enabled") is False
        )

        for app_id, group_title in (
            ("browser", "位置"),
            ("gallery", "位置"),
            ("mail", "通讯录"),
            ("mail", "存储"),
        ):
            try:
                await _open(env, f"/page/app_permission_detail__{app_id}")
                await _click(env, group_title)
                await _click_any(env, "允许", "Allow")
                await _click_any(env, "完成", "Done")
            except Exception as exc:
                page_text = await env.page.locator("body").inner_text()
                raise AssertionError(
                    f"permission UI failed for {app_id}/{group_title}: {page_text[:1000]}"
                ) from exc

        state = await env.get_state(required_apps=["settings"])
        permission_paths = {
            "browser.ACCESS_FINE_LOCATION": (
                "browser",
                "android.permission.ACCESS_FINE_LOCATION",
            ),
            "browser.ACCESS_COARSE_LOCATION": (
                "browser",
                "android.permission.ACCESS_COARSE_LOCATION",
            ),
            "gallery.ACCESS_FINE_LOCATION": (
                "gallery",
                "android.permission.ACCESS_FINE_LOCATION",
            ),
            "gallery.ACCESS_COARSE_LOCATION": (
                "gallery",
                "android.permission.ACCESS_COARSE_LOCATION",
            ),
            "mail.READ_CONTACTS": ("mail", "android.permission.READ_CONTACTS"),
            "mail.READ_EXTERNAL_STORAGE": (
                "mail",
                "android.permission.READ_EXTERNAL_STORAGE",
            ),
            "mail.WRITE_EXTERNAL_STORAGE": (
                "mail",
                "android.permission.WRITE_EXTERNAL_STORAGE",
            ),
        }
        permission_actual = {
            label: state["os"]["permissions"][app_id][permission_id]
            for label, (app_id, permission_id) in permission_paths.items()
        }
        results["declared_app_permissions"] = all(
            value == "granted" for value in permission_actual.values()
        )
    finally:
        await env.close()
    if not all(results.values()):
        raise AssertionError({
            "results": results,
            "permission_actual": permission_actual,
        })
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sim-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(main_async(args.sim_url)), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
