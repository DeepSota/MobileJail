# MobileJail 真实文件、分享与系统设置实施计划

设计依据：

- `docs/superpowers/specs/2026-07-10-realistic-mobile-files-sharing-settings-design.md`
- `docs/superpowers/specs/2026-07-10-realistic-document-viewer-design.md`

## 实施原则

- 先修复当前 FileManager 未提交实现中的断链，再扩展功能。
- 以测试驱动纯数据契约和路由行为；UI 完成后补集成和截图验证。
- 保留越狱任务、benchmark、网关和其他用户未提交改动；重叠文件逐块合并。
- 新用户可见文本进入 `res/strings.ts` 和英文覆盖。
- 导航、弹层和离散状态遵守声明与 URL 驱动规则。

## 任务 1：锁定基线和修复验证工具

修改 `scripts/check_navigation_declaration_consistency.mjs`、`scripts/build_nav_artifacts.mjs` 及相关测试，使工具自动发现 `apps/<Name>` 或 `system/<Name>`。记录当前 Settings/FileManager artifacts 的既有警告，后续新增改动不得引入新的 ERROR。

验证：针对一个 apps App 和两个 system App 运行一致性检查与 graph generation。

## 任务 2：稳定 FileRef 与 content URI

新增 `os/FileShareService.ts` 和测试；扩展 `os/FileSystemService.ts`：

- `getNodeById`、`readFileById`。
- `content://simfs/files/<fileId>` 创建和解析。
- `createFileRef`、旧路径兼容解析。
- clone-on-send 到目标 App 私有附件目录。
- 文件移动/改名后 fileId 稳定，删除源文件后私有副本仍可读。

测试 URI 注入、目录引用、缺失文件、重名、取消分享和复制失败。

## 任务 3：Intent 分享契约和 chooser

修改 `os/IntentResolver.ts`、相关类型和 chooser：

- 解析 `SharePayloadV1`，兼容 `data.stream`。
- 单文件、同类多文件和混合类型 MIME 推导。
- `*/*`、`type/*` 与精确 MIME 匹配。
- 同一 App 多个 filter 去重并选最具体匹配。
- 只展示页面实际声明并实现的目标。

补 resolver 和 chooser 单元测试。

## 任务 4：FileManager 统一打开和分享

完成并修正当前未提交的 `fileFormatRegistry`、`useOpenFile`、四个入口页和 `fileOperations`：

- 扩展名优先，只有无扩展名才使用 MIME fallback。
- 图片 MIME 不得覆盖已知文档扩展名。
- Browse、Folder、Recent、Category、Viewer 均可分享。
- 混合选择不得静默丢文件。
- Unsupported sheet 改为 URL uiState，Back 优先关闭。
- 补完整 navigation routes、transitions、actions 和 DOM tags。

## 任务 5：统一 Viewer 外壳和路由

新增 `DocumentViewerPage`、`DocumentViewerShell`、viewer 状态类型、格式图标和适配器接口。注册 `/viewer?path=...` 与 `ACTION_VIEW` 文档 MIME 入口；迁移旧 `/text`、`/pdf`。

实现 loading、ready、empty、corrupted、password-protected、too-large、converter-offline、busy、timeout、分享和返回。

## 任务 6：PDF 与文本查看器

安装 `pdfjs-dist`：逐页 Canvas、可见页渲染、页码、缩略图、搜索和缩放。实现 TXT/LOG BOM/UTF-8/GB18030 解码、行号、搜索、换行和字号。删除 PDF 正则抽取路径。

补 PDF/text 模型测试与 360×800 截图验证。

## 任务 7：Office 转换服务

完成当前 `office_preview.py`、Vite middleware、gateway 和 Nginx 合并：扩展名/魔数、25 MiB、独立 profile、并发/队列、45 秒超时、缓存、输出 PDF 校验和错误映射。用共享契约 fixture 保证 Python/Vite parity。

运行 Python 单测和真实 DOCX/PPTX smoke test。

## 任务 8：Word、PowerPoint 与 Excel

- Word/PPT 调用 Office preview，复用 PDF 页面模型并使用各自外壳。
- 安装 `xlsx`，实现工作表网格、sheet tabs、单元格选择、公式栏、基础样式、搜索和缩放。
- Excel 页面视图按需请求 Office preview。

补最小真实 DOC/DOCX/XLS/XLSX/PPT/PPTX fixture 测试。

## 任务 9：真实种子文件

替换 `public/sdcard/Documents` 的空文件，生成小体积中文 PDF/TXT/LOG/DOC/DOCX/XLS/XLSX/PPT/PPTX，以及 MD/JSON/CSV 拒绝样例。提升 `SEED_SCHEMA_VERSION` 并验证升级不会覆盖用户后续创建的非种子文件。

## 任务 10：微信、短信、邮件完整闭环

各 App 完成：消费 SharePayload、选择联系人/会话、确认发送时 clone、持久化附件卡片、点击 ACTION_VIEW、Back 回原页面。

- WeChat：扩展 ShareForward 与 file bubble，多选收件人按 App 原交互处理。
- SMS：增加 application receiver、consume intent、文件消息和联系人/群发。
- Mail：Compose 保留 stream，联系人邮箱选择，多附件持久化，详情附件可点。

分别验证源文件删除后重新打开。

## 任务 11：其余联系人型 App

为 Alipay、Bilibili、RedBook、X 的现有私信联系人和 TencentMeeting 当前会议参与者增加真实 share receiver、附件消息和重新打开能力。没有活动会议时 TencentMeeting 不作为可用目标；发布/import 入口保持独立语义。

优先复用共享 FileAttachmentCard，不改变各 App 已有主页和聊天视觉层级。

## 任务 12：Settings 高频能力层

新增小型 capability/key-alias 配置，不直接改写大体量 `pages.json`。接通：

- 飞行模式、移动数据、热点、VPN、NFC、定位。
- 亮度、自动亮度、深色、护眼、字号、显示大小和超时。
- 四类音量、静音、DND。
- 电池、存储、应用通知、权限、默认打开、语言、日期时间和设备信息。

修复高频断链；未实现入口显示禁用态且不带误导箭头。

## 任务 13：Settings 导航与真实交互

给高频专用页增加 actions、gesture binding 和 scroll tags。将 List/Value/Wi-Fi/BT 等弹窗迁移到 URL uiState，Back 先关闭弹层。保留 HyperOS/MIUI 视觉，仅优化动态摘要、错误反馈、禁用态和状态同步。

## 任务 14：回归、构建与端到端验证

按风险顺序运行：

```bash
npm test
npx tsc --noEmit
npx eslint os system apps
npm run build
python -m pytest scripts/server/test_office_preview.py
node scripts/build_nav_artifacts.mjs FileManager
node scripts/build_nav_artifacts.mjs Settings
```

随后在 360×800 与 412×915 验证：全格式打开、搜索/缩放/工作表、分享 chooser、各 App 收件人发送、删除源文件后重开、Back 返回、Settings 跨系统副作用和错误状态。

## 任务 15：提交隔离

每批提交前用 `git diff --cached --name-only` 确认没有包含越狱任务、benchmark 或用户其他未提交改动。最终交付列出所有文件、transition/action ID、测试结果和任何既有警告。
