# MobileJail 真实文件、跨应用分享与系统设置完善设计

- 日期：2026-07-10
- 状态：已获用户批准，可直接实施
- 目标项目：`/home/public/songping/mobilejail`
- 视觉基准：保留现有 HyperOS/MIUI 风格，在不破坏既有页面的前提下提升真实感
- 关联设计：`2026-07-10-realistic-document-viewer-design.md`

## 1. 目标

本轮以真实手机的纵向使用链路为验收对象，而不是逐个重绘全部应用：

1. 用户能从文件夹、最近、分类和查看器中打开真实文件。
2. 用户能把图片及文档通过系统分享面板发送给目标 App 中的联系人、会话或会议参与者。
3. 接收 App 保存独立附件副本；原文件移动、改名或删除后，历史消息中的附件仍能打开。
4. 点击 App 内附件卡片时，统一查看器以同一任务栈的新 Activity 打开，返回后回到原会话。
5. Settings 的高频设置真实改变 OS 状态，并能被状态栏、快捷设置、系统服务和其他 App 感知。

## 2. 文件格式范围

### 2.1 必须支持

- 图片：JPEG、PNG、GIF、WebP，以及虚拟媒体库已有的图片格式。
- 文本：TXT、LOG。
- 页面文档：PDF、DOC、DOCX。
- 表格：XLS、XLSX。
- 演示文稿：PPT、PPTX。

PDF 使用 PDF.js 真实页面渲染；TXT/LOG 使用浏览器解码；DOC/DOCX/PPT/PPTX 通过本地 LibreOffice 转换为临时 PDF 页面；XLS/XLSX 默认使用 SheetJS 工作表网格，并提供页面视图回退。

### 2.2 明确不支持

MD、JSON、CSV 和未注册格式显示系统风格“暂无可用应用打开此文件”，不能被宽泛 MIME 规则误判。损坏、空文件、密码保护、伪扩展名和服务离线使用独立错误状态。

### 2.3 不在范围内

- 不编辑或写回 Office/PDF 文件。
- 不做在线 Office、云同步、协作批注或打印。
- 不强迫没有联系人、会话或附件语义的 App 接收文件。

## 3. 系统级文件身份

文件路径不能作为长期身份，因为移动和重命名会改变路径。新增稳定的文件引用：

```ts
interface FileRefV1 {
  version: 1;
  fileId: string;
  uri: string; // content://simfs/files/<fileId>
  path?: string; // 仅兼容旧数据和调试
  name: string;
  mimeType: string;
  size: number;
  modifiedAt?: number;
  thumbnailUri?: string;
  width?: number;
  height?: number;
}

interface SharePayloadV1 {
  version: 1;
  files: FileRefV1[];
  text?: string;
  subject?: string;
}
```

`FileSystemService` 提供按 `fileId` 查询和读取、`content://simfs` 解析及克隆接口。迁移期继续读取旧 `data.stream` 路径，但所有新分享只写 `SharePayloadV1`。

## 4. 分享与持久化

### 4.1 发送流程

```text
FileManager/Gallery/Viewer
  -> createSharePayload(files)
  -> ACTION_SEND
  -> IntentResolver capability filtering
  -> system chooser
  -> target app recipient picker
  -> user confirms send
  -> clone-on-send into target app private attachment area
  -> persist message attachment FileRef
```

列表选择支持单文件、多文件及图片和文档混合选择。顶层 Intent MIME 用于筛选目标；每个 `FileRef` 始终保留真实 MIME。混合类型按 `*/*` 匹配，chooser 按 `appId` 去重并选择最具体的 filter。

### 4.2 独立附件副本

临时分享引用只用于收件人选择和发送确认。确认发送时，目标 App 将内容克隆到自身私有附件区域并保存新的稳定 `FileRef`。取消分享不产生副本。删除原文件、清理原目录或移动原文件不会影响历史附件。

### 4.3 目标能力矩阵

第一阶段为具有自然收件人语义的 App 建立完整闭环：

| App | 收件人来源 | 图片 | 文档 | 重新打开 |
| --- | --- | --- | --- | --- |
| 微信 | 好友、群聊、最近会话 | 是 | 是 | Gallery / Document Viewer |
| 短信 | 系统联系人、手机号、群发会话 | 是 | 是 | Gallery / Document Viewer |
| 邮件 | 系统联系人、邮箱地址、多收件人 | 是 | 是 | Gallery / Document Viewer |
| 支付宝 | App 联系人、聊天会话 | 是 | 是 | Gallery / Document Viewer |
| 哔哩哔哩 | 私信联系人、已有会话 | 是 | 是 | Gallery / Document Viewer |
| 小红书 | 私信联系人、已有会话 | 是 | 是 | Gallery / Document Viewer |
| X | 私信联系人、已有会话 | 是 | 是 | Gallery / Document Viewer |
| 腾讯会议 | 当前会议所有人或指定参会者 | 是 | 是 | Gallery / Document Viewer |

腾讯会议无进行中会议时不作为联系人分享目标。公开发布、记事本导入和相册导入是不同语义，可按 MIME 出现在 chooser 中，但不冒充“发送给联系人”。

## 5. App 内附件体验

各 App 使用自身视觉风格显示附件卡片，但共享字段和行为：格式图标、文件名、大小、发送状态、失败重试和点击打开。

- 图片显示缩略图，点击进入 Gallery。
- PDF/TXT/Office 显示格式色和后缀，点击发出 `ACTION_VIEW`。
- FileManager 的统一查看器以 standard Activity 推到当前 App 任务栈。
- 查看器返回时 `finishActivity()`，恢复原会话及滚动位置。
- 附件损坏或私有副本缺失时显示可理解的错误，不发送空白消息。

## 6. 统一文件查看器

查看器继续遵循既有高拟真设计：

- PDF/Word：连续纸张、缩略图、页码、搜索、缩放和分享原附件。
- Excel：工作表标签、行列标题、公式栏、单元格选择、搜索和缩放。
- PowerPoint：幻灯片缩略图、上一页/下一页、适应屏幕和缩放。
- TXT/LOG：行号、搜索、自动换行、字号及编码标识。
- 所有格式共享 loading、empty、corrupted、password-protected、too-large、converter-offline、busy 和 timeout 状态。

打开入口统一来自 Browse、Recent、Category、Folder、App 附件卡片和外部 `ACTION_VIEW`。旧 `/pdf`、`/text` 路径迁移到 `/viewer`。

## 7. Settings 完善范围

### 7.1 架构

保留 `pages.json` 作为大规模描述数据，不直接重写 623 个页面。新增小型 capability/alias 层，将高频 key 路由到 OS Manager 和专用页面；未实现入口不再伪装成可用功能。

### 7.2 高频闭环

- 网络：Wi-Fi、蓝牙、飞行模式、移动数据、热点、VPN、NFC、定位。
- 显示：亮度、自动亮度、深色模式、护眼、字号、显示大小、屏幕超时。
- 声音：媒体、铃声、通知、闹钟音量，静音和勿扰。
- 电池：电量、节电模式、充电状态和应用耗电摘要。
- 存储：真实容量统计、分类入口和 same-task 打开 FileManager。
- 应用：应用列表、通知、权限、存储占用和默认打开方式。
- 系统：语言、日期时间、地区、安全隐私、关于设备。

设置结果写入 `OsStateStore` 或对应 Manager，必须对状态栏、快捷设置、NotificationService、PermissionService、Launcher 和相关 App 生效。

### 7.3 导航与交互

- 所有高频离散交互声明 transition/action 并使用 gesture hooks 绑定。
- 弹窗和底部选择面板使用 URL uiState；系统 Back 先关闭弹层。
- 页面补齐 `data-scroll-container`、状态栏前景和禁用态。
- 修复导航工具对 `system/<AppName>` 的定位，Settings/FileManager 均能生成 artifacts。

## 8. 视觉与真实感

- Settings 延续当前 HyperOS/MIUI 卡片、折叠标题和色彩体系。
- FileManager 保持现有结构，补文件类型图标、真实大小/时间、加载骨架、错误页和底部分享面板。
- 系统 chooser 展示目标 App 图标、名称和能力摘要；只展示实际能消费当前 payload 的目标。
- 新增用户可见文本全部进入各 App `res/strings.ts` 与英文覆盖，不在 JSX 散落中英文文字。
- 所有按钮至少 40×40 px，支持键盘焦点和 360×800/412×915 主视口。

## 9. 错误处理与安全

- 分享准备、复制和消息持久化使用事务式顺序；复制失败时不创建成功消息。
- Office 转换限定 25 MiB、扩展名和签名白名单、独立 profile、45 秒超时、并发 2、缓存和进程组清理。
- `content://simfs` 只解析虚拟文件系统内的 fileId，不接受任意宿主机路径。
- 接收 App 只读取 Intent 中的结构化 payload，不执行文件内容。
- 源文件和私有附件不会被预览服务写回。

## 10. 验证

### 10.1 单元测试

- 格式注册、魔数、MIME、空文件及伪扩展名。
- FileRef 创建、URI 解析、移动/重命名稳定性和 clone-on-send。
- chooser MIME 匹配、去重、混合文件及取消流程。
- Settings key alias 与 Manager 副作用。

### 10.2 集成测试

- 四个 FileManager 入口和 App 附件入口打开同一文件。
- 微信、短信、邮件及其余联系人型目标完成“选择收件人、发送、重新打开”。
- 删除源文件后，历史附件仍可查看。
- 图片进入 Gallery；文档进入统一 viewer；Back 返回原会话。
- Settings 高频控制能被 OS 其他消费者观察。

### 10.3 最终验证

运行相关 Vitest、Python preview 测试、TypeScript、ESLint、生产构建和 Settings/FileManager 导航 artifacts，并在 360×800 与 412×915 下进行截图和交互回归。

## 11. 验收标准

1. 图片及 PDF/TXT/DOCX/XLSX/PPTX 能从任意公开文件夹分享给支持的联系人型 App。
2. 目标 App 内出现真实附件卡片，点击可查看，Back 回到原会话。
3. 原文件移动、改名或删除后，已发送附件仍可打开。
4. chooser 不出现不能消费附件的假目标，也不丢失混合选择中的文件。
5. Office、PDF、文本和表格显示真实内容，不使用占位文本或正则伪解析。
6. Settings 高频入口具有真实 OS 副作用、可观测导航标签和正确返回行为。
7. 现有文件复制、移动、删除、图片查看及各 App 原有主流程不回归。

## 12. 实施边界

本轮只修改 `mobilejail`。继续复用当前工作区已经存在的 FileManager 和 Office preview 未提交实现，不覆盖越狱数据集、生成器、网关中无关配置或用户其他未提交改动。
