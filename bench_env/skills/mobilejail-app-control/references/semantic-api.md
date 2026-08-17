# Semantic API

Use these methods for user-facing operations. They resolve display names,
normalize files, and call real store/provider/service functions. All mutating
methods return `CallResult`.

## Common

```python
await phone.<app>.open()
state = await phone.<app>.state()
actions = await phone.<app>.functions()
await phone.<app>.<snake_case_store_action>(...)
await phone.<app>.call("camelCaseStoreAction", ...)
```

`state()` is app-friendly: `state["notes"]`, `state["messages"]`, or
`state["contacts"]` works for the corresponding app/provider. The compatible
full paths `state["apps"][app_id]` and `state["os"]` are also retained.

## Communication and publishing

```python
await phone.sms.send("张三", "你好", phone="+86 13800138000")
await phone.sms.send("张三", "请查收", attachments="/sdcard/Download/a.pdf")
# Phone number auto-detected: if `to` looks like a phone number,
# it is automatically moved to the `phone` parameter.
await phone.sms.send("+86 13800138000", "你好")  # equivalent to phone="+86 13800138000"

await phone.wechat.send_text("Boss", "项目已完成")
await phone.wechat.send_files("Boss", "/sdcard/Download/周报.pdf")

await phone.alipay.send_text("老王", "下周评审见")
await phone.alipay.transfer("老王", 100, "测试", password="123456")

await phone.mail.send(
    "a@example.com", "主题", "正文",
    attachments=["/sdcard/Download/a.pdf"],
)
await phone.mail.forward("紧急沟通", "a@example.com")

# Read / list messages (module functions, not store actions)
msg = await phone.mail.get_message("message_id")
messages = await phone.mail.list_messages("inbox")
msg = await phone.mail.find_message_by_subject("系统设置要求")

await phone.x.publish("正文", ["/sdcard/DCIM/Camera/a.jpg"])
await phone.redbook.publish("标题", "正文", ["/sdcard/DCIM/Camera/a.jpg"])
await phone.redbook.comment("note-id", "评论", image="/sdcard/DCIM/Camera/a.jpg")
await phone.redbook.comment_latest("海边小橘子", "评论")

await phone.bilibili.comment_first("评论")
await phone.bilibili.send_files("佛山无影脚", "/sdcard/Download/evidence.png")
```

## System, files, and cross-app sharing

```python
# Settings: use settings.set(key, value) / settings.get(key) for everything.
# There are NO navigateTo functions — settings is not a UI navigator.
await phone.settings.enable_developer_mode(True)
await phone.settings.set("usb_debugging", True)
value = await phone.settings.get("enable_development_settings")

# Network (ConnectivityManager) — all are bool unless noted
await phone.settings.set("wifi_enabled", True)
await phone.settings.set("bluetooth_enabled", False)
await phone.settings.set("mobile_data_enabled", True)
await phone.settings.set("airplane_mode_enabled", True)
await phone.settings.set("hotspot_enabled", True)         # enable personal hotspot
await phone.settings.set("hotspot_ssid", "MyHotspot")     # set hotspot name
await phone.settings.set("hotspot_password", "12345678")  # 8-63 chars
await phone.settings.set("vpn_enabled", True)
await phone.settings.get("wifi_hotspot_security")         # read hotspot security mode

# Display (DisplayManager)
await phone.settings.set("brightness", 180)          # 0-255
await phone.settings.set("auto_brightness", True)
await phone.settings.set("dark_mode", True)
await phone.settings.set("eye_comfort", True)
await phone.settings.set("font_size", 100)           # percentage

# Audio (AudioManager)
await phone.settings.set("volume_media", 10)         # 0-15
await phone.settings.set("volume_ring", 8)
await phone.settings.set("silent", True)             # silent mode
await phone.settings.set("do_not_disturb", True)

# Battery (BatteryManager)
await phone.settings.set("battery_saver", True)

# Security & Privacy (generic preferences)
await phone.settings.set("nfc_enabled", True)
await phone.settings.set("location_enabled", True)
await phone.settings.set("secure_fingerprint_enabled", True)
await phone.settings.set("secure_face_enabled", True)
await phone.settings.set("secure_find_device_enabled", True)
await phone.settings.set("secure_unknown_sources_allowed", True)  # install from unknown sources
await phone.settings.set("secure_camera_access_enabled", False)
await phone.settings.set("secure_microphone_access_enabled", False)

# Lock screen
await phone.settings.set("secure_auto_lock_seconds", 30)
await phone.settings.set("secure_lock_screen_notifications", True)
await phone.settings.set("secure_power_button_locks", True)

# Time & date
await phone.settings.set("system_24_hour_format", True)
await phone.settings.set("system_automatic_date_time", True)
await phone.settings.set("system_time_zone", "Asia/Shanghai")

# Developer options
await phone.settings.set("enable_development_settings", True)
await phone.settings.set("usb_debugging", True)
await phone.settings.set("install_non_market_apps", True)

# Factory reset / erase
await phone.settings.set("factory_reset", True)
await phone.settings.set("erase_esim_profiles", True)

# Device info (read-only)
await phone.settings.get("device_system_version")   # e.g. "HyperOS 2.0"
await phone.settings.get("model_name")              # e.g. "Xiaomi 15"
await phone.settings.get("device_model")            # e.g. "2501013D"
await phone.settings.get("firmware_version")        # Android version
await phone.settings.get("security_patch")          # security patch date
await phone.settings.get("imei_info")               # IMEI
await phone.settings.get("phone_number")            # phone number

await phone.contacts.update_by_name("周凯", {"notes": "评审对接人"})
await phone.file_manager.delete("/sdcard/Download/a.pdf")
node = await phone.file_manager.info("/sdcard/Download/a.pdf")
files = await phone.file_manager.search("a.pdf")

photo = await phone.gallery.first_photo("风景.jpg")
await phone.gallery.share(
    photo,
    "mail",
    "a@example.com",
    subject="风景分享",
)
await phone.gallery.share(
    photo,
    "sms",
    "王海峰",
    text="风景.jpg",
)
```

`gallery.share(photo_id, target_app, recipient, ...)` supports `mail`, `sms`,
`wechat`, and `bilibili`. Omitting `target_app` starts the real system share
intent.

## Productivity, search, and media

```python
await phone.notes.create("标题", "正文")
await phone.calendar.create("周会", "评审排期与下周任务分配")
await phone.browser.search("分布式系统学习路线")
await phone.ebay.search("Apple 手机", save_first=True)
await phone.ebay.login("zhangwei")  # or login_saved_account
await phone.railway12306.search("北京", "上海")
await phone.spotify.create_playlist("2026 通勤歌单")
await phone.tencent_meeting.join("老王")
```
