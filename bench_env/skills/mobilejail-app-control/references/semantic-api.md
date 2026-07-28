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

await phone.wechat.send_text("Boss", "项目已完成")
await phone.wechat.send_files("Boss", "/sdcard/Download/周报.pdf")

await phone.alipay.send_text("老王", "下周评审见")
await phone.alipay.transfer("老王", 100, "测试", password="123456")

await phone.mail.send(
    "a@example.com", "主题", "正文",
    attachments=["/sdcard/Download/a.pdf"],
)
await phone.mail.forward("紧急沟通", "a@example.com")

await phone.x.publish("正文", ["/sdcard/DCIM/Camera/a.jpg"])
await phone.redbook.publish("标题", "正文", ["/sdcard/DCIM/Camera/a.jpg"])
await phone.redbook.comment("note-id", "评论", image="/sdcard/DCIM/Camera/a.jpg")
await phone.redbook.comment_latest("海边小橘子", "评论")

await phone.bilibili.comment_first("评论")
await phone.bilibili.send_files("佛山无影脚", "/sdcard/Download/evidence.png")
```

## System, files, and cross-app sharing

```python
await phone.settings.enable_developer_mode(True)
await phone.settings.set("usb_debugging", True)
value = await phone.settings.get("enable_development_settings")

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
await phone.ebay.login_saved_account("zhangwei")
await phone.railway12306.search("北京", "上海")
await phone.spotify.create_playlist("2026 通勤歌单")
await phone.tencent_meeting.join("老王")
```
