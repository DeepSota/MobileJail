# MobileJail App Control Skill 需求

## 目标

在 `MobileJail/bench_env/skills/mobilejail-app-control/` 中实现一个 Skill，
通过纯代码调用完成 MobileJail 全部第三方 App 和系统 App 的功能，不依赖视觉
GUI Agent 规划。

覆盖范围以以下目录中的 manifest 为准：

- `MobileJail/apps/*/manifest.ts`
- `MobileJail/system/*/manifest.ts`

## 设计

采用“App-as-Class，功能-as-Function”：

```python
phone = MobileJail(env)

await phone.sms.send("张三", "你好", phone="+86 13800138000")
await phone.wechat.send_text("wxid_boss", "项目已完成")
await phone.x.publish("测试帖子")
await phone.redbook.comment(note_id, "测试评论")
await phone.settings.set("wifi_enable", False)
await phone.file_manager.delete("/sdcard/Download/test.txt")
await phone.alipay.transfer("老王", 100, "测试", password="123456")
```

要求：

1. 只实现一个 Skill。
2. 每个 App 使用独立 class，包括 `apps/` 和 `system/`。
3. 每种业务功能使用独立函数。
4. 直接复用 App 的 Zustand action、provider 函数或 OS service 函数。
5. 不得使用 `env.set_state()` 伪造用户操作结果。
6. 对 store 中的全部 action 提供 camelCase 和 snake_case 动态函数调用。
7. 对没有 store action、只存在于 React 本地状态的功能，通过
   `navigation.declaration.ts` 对应的 `data-action` / `data-trigger` 调用真实事件
   处理器；不得依赖截图识别。
8. 支持按显式 route 打开 App 页面，再调用该页面的功能。
9. 每次调用记录执行前状态、执行后状态、返回值和变化路径。
10. 变更型函数未产生预期状态变化时必须报错，不得静默成功。

## Skill 结构

```text
bench_env/skills/mobilejail-app-control/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
│   ├── mobilejail_apps.py
│   ├── build_catalog.py
│   └── self_test.py
└── references/
    ├── apps.md
    └── contracts.md
```

遵循 `MobileJail/A-如何写出好的Skill.md`：

- `SKILL.md` 只保留核心工作流和硬约束。
- 完整能力清单放入 `references/`，按需读取。
- 能力发现、执行和覆盖校验放入确定性脚本。
- 不创建 README、CHANGELOG 或重复的快速参考文档。

## 验收标准

1. `APP_CLASSES` 与当前全部 App manifest ID 完全一致。
2. 每个 App 可通过 `MobileJail(env).<app_id>` 获得独立 class 实例。
3. `await app.functions()` 能列出当前真实 store action。
4. 任意真实 store action 可通过 `await app.<snake_case>(...)` 或
   `await app.call("<camelCase>", ...)` 执行。
5. provider/OS 功能可以通过模块函数执行。
6. UI-local 功能可以通过 `app.route()` + `app.ui()` 执行。
7. SMS、Mail、Wechat、X、RedBook、Settings、FileManager、Gallery、Alipay
   提供明确的语义函数。
8. `self_test.py`、Python 编译检查和 Skill `quick_validate.py` 全部通过。
9. 能力目录可由 `build_catalog.py` 从当前源码重新生成，不依赖手工维护。
