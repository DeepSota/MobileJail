# MobileJail 高拟真只读文件查看器设计

- 日期：2026-07-10
- 状态：待用户审阅
- 目标项目：`/home/public/songping/mobilejail`
- 已确认视觉方向：方案 C，最大程度模拟手机端 WPS/Office
- 已确认技术方向：混合渲染

## 1. 背景与目标

MobileJail 的“文件”应用目前只能以简单白底文本查看 TXT，并用正则从极少数未压缩 PDF 中抽取文本。真实 PDF 大多无法解析；DOC、DOCX、XLS、XLSX、PPT、PPTX 虽可被文件扫描器识别，却没有可用的打开路径。`public/sdcard/Documents` 内四个示例文档还是 0 字节占位文件。

本次改造要让手机虚拟文件系统中的真实文件可以从“浏览”“最近”“文档分类”和具体文件夹中打开，并以接近手机端 WPS/Office 的只读界面查看内容。所有入口、加载状态、错误提示和返回行为必须一致，不能只为演示文件做硬编码。

## 2. 范围

### 2.1 必须支持打开查看

| 格式 | 查看方式 | 主要交互 |
| --- | --- | --- |
| PDF | PDF.js 真实页面渲染 | 连续分页、缩放、页码、缩略图、搜索、分享 |
| TXT、LOG | 浏览器文本解码 | 行号、搜索、自动换行、字号、编码标识、分享 |
| DOC、DOCX | LibreOffice 转 PDF 后由 PDF.js 渲染 | Word 风格页面、缩略图、缩放、搜索、分享 |
| XLS、XLSX | SheetJS 解析为只读工作表网格 | 行列标题、单元格选择、公式栏、工作表标签、缩放、搜索、页面视图 |
| PPT、PPTX | LibreOffice 转 PDF 后按幻灯片渲染 | 左侧缩略图、上一页/下一页、缩放、全页适配、分享 |

### 2.2 明确不支持打开

MD、JSON、CSV 必须显示真实的系统风格“暂无可用应用打开此文件”提示，不能继续被 `text/*` 的宽泛判断误判为文本预览。

其他未注册格式执行相同行为。支持格式如果内容为空、损坏、受密码保护或扩展名与内容不符，应显示对应错误，而不是误报“暂无可用应用”。

### 2.3 不在范围内

- 不编辑或回写任何文件。
- 不提供批注、协作、云端同步、打印或格式转换下载。
- 不依赖 Google、Microsoft 或其他公网在线查看器。
- 不同步修改 `/home/public/songping/mobilegym-main`。
- 已复制的 `mobilegym-data` 保持为本地、Git 忽略的数据目录。

## 3. 用户体验设计

### 3.1 统一外壳

新增统一的 `DocumentViewerShell`。它负责状态栏下方的应用标题栏、文件名、格式图标、只读标识、更多菜单、加载状态、错误状态、返回手势和资源清理。不同格式共享交互逻辑，但使用各自的品牌色和内容布局：

- Word：蓝色标题栏、白色纸张、页间阴影。
- Excel：绿色标题栏、名称框、公式栏、行列标尺、工作表标签。
- PowerPoint：橙色标题栏、幻灯片缩略图轨道和主画布。
- PDF：深色阅读器工具栏、灰色页面背景。
- TXT/LOG：中性灰标题栏、等宽字体、行号栏。

“查看、页面、工具”等可见入口必须有实际只读功能；不做空按钮。编辑、审阅和保存入口不展示，或以明确的“只读模式”说明替代。

### 3.2 各格式界面

#### PDF 与 Word

- 首屏显示当前页，后台只预加载相邻页。
- 连续滚动时保留纸张边界、页间距和阴影。
- 底部工具栏提供缩略图、缩小、当前比例、放大和分享。
- 页码浮层随滚动更新；搜索结果可定位到对应页面。
- Word 使用蓝色 W 图标和“DOC/DOCX · 只读模式”，但内容仍由转换后的真实页面承载。
- 分享始终发送原始用户文件，不分享或写回服务端生成的 PDF 预览。

#### Excel

- 默认进入工作表网格，不把 Excel 简化为 PDF 长页。
- 顶部显示名称框和所选单元格的格式化值或公式。
- 支持工作表切换、合并单元格、基础数字格式、列宽、行高和冻结窗格。
- 大表格只渲染可见行列，横纵滚动互不阻塞。
- 对包含复杂图表或打印版式的工作簿提供“页面视图”，按需请求 LibreOffice PDF 预览；解析失败时也以此作为回退。

#### PowerPoint

- 左侧为可滚动缩略图，右侧/主体为按原始宽高比显示的幻灯片。
- 提供上一页、下一页、适应屏幕、放大缩小和当前页码。
- 竖屏保持单页清晰可读；空间不足时缩略图轨道可收起。

#### TXT 与 LOG

- 使用 `TextDecoder` 解码，带 BOM 时按 BOM 选择编码；无 BOM 时优先 UTF-8，出现大量替换字符时回退到常见中文 GB18030。
- 显示行号、搜索、换行开关和字号调整。
- LOG 保留空格、制表符与换行，不做 Markdown 或 JSON 高亮。
- 空文本显示“文件为空”，不是空白页面。

### 3.3 无可用应用提示

点击 MD、JSON、CSV 或其他未支持格式时，在当前文件列表上方显示 Android 风格底部弹层：文件图标、完整文件名、“暂无可用应用打开此文件”、取消按钮。关闭后仍停留在原列表和滚动位置。

## 4. 架构与数据流

```text
Browse / Recent / Category / Folder
              │
              ▼
        useOpenFile(node)
              │
              ▼
     FileFormatRegistry.classify
        │                 │
  unsupported          supported
        │                 │
  系统提示弹层      /viewer?path=...
                          │
                          ▼
              FileSystem.readFile(path)
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
      PDF.js          TXT/LOG         Office adapters
                                       │            │
                                  XLS/XLSX     DOC/PPT families
                                  SheetJS       preview API
                                       │            │
                                       └──────┬─────┘
                                              ▼
                                  DocumentViewerShell
```

### 4.1 统一格式注册表

`fileFormatRegistry.ts` 是格式支持的唯一真源，返回：

- `kind`：`pdf | text | word | spreadsheet | presentation | unsupported`
- `extension` 与规范 MIME
- 预期文件签名
- 使用的适配器
- 颜色、图标和界面能力

分类以小写扩展名白名单为主，MIME 只作辅助；随后检查文件签名：PDF 为 `%PDF-`，OOXML 为 ZIP/`PK` 并包含对应目录，旧 Office 为 OLE/CFB 魔数。零字节先于签名检查。

### 4.2 统一打开入口

新增 `useOpenFile()`，替换 BrowseHomePage、FolderPage、RecentPage 和 CategoryPage 中分散的点击判断。它负责：

1. 保持选择模式与长按逻辑不变。
2. 目录继续进入文件夹。
3. 图片继续交给 Gallery。
4. 支持的文档进入统一 `/viewer` 路由。
5. 不支持格式打开系统提示弹层。

同时修正两个列表数据源：RecentPage 从整个虚拟文件系统按修改时间收集最近文件，不再局限于媒体和 Download；CategoryPage 的“文档”分类按格式注册表收集支持与不支持的文档格式，使 TXT/LOG、Office、MD/JSON/CSV 都可见并执行正确点击行为。

导航声明允许从 `/`、`/folder`、`/recent` 和 `/category/:category` 进入查看器。返回时必须回到原入口及原滚动位置。

### 4.3 渲染适配器

每个适配器只负责把 Blob 转换成可渲染模型，并提供 `dispose()`：

- `pdfAdapter`：PDF.js document、页面数量和文本搜索。
- `textAdapter`：文本、编码、行索引。
- `spreadsheetAdapter`：SheetJS workbook、工作表元数据和可见单元格查询。
- `officePageAdapter`：调用预览 API，验证返回 PDF，再交给 `pdfAdapter`。

适配器通过动态导入加载。未打开文件时，不加载 PDF.js 或 SheetJS 的主包和 worker。

## 5. Office 预览服务

### 5.1 接口

```http
POST /api/preview/office
Content-Type: application/octet-stream
X-File-Extension: docx

<raw file bytes>
```

成功返回 `application/pdf`、内容哈希 ETag 和转换器版本。接口只接受 `doc/docx/xls/xlsx/ppt/pptx`，最大原文件 25 MiB。

状态码约定：

- `413`：文件过大。
- `422`：损坏、伪扩展名、加密或转换失败。
- `429`：转换队列繁忙。
- `504`：45 秒内未完成。
- `503`：转换服务未安装或不可用。

### 5.2 开发与生产一致性

- Nginx/benchmark 环境：在现有 Starlette `api_gateway.py` 增加路由，并在 Nginx 为 `/api/preview/` 单独设置 25 MiB 请求限制和 65 秒读取超时。
- Vite 开发环境：增加同路径的开发中间件，复用相同的扩展名、大小、签名、命令参数和响应契约，保证 `npm run dev` 不需要外部在线服务。
- 浏览器只依赖相对 URL，兼容根部署与 `/sim/` 子路径部署。

### 5.3 转换隔离与缓存

- 使用参数数组调用 `soffice`，不拼接 shell 命令。
- 每个任务使用 UUID 临时目录和独立 `UserInstallation` profile。
- 全机最多同时执行 2 个转换任务；其余进入有上限的短队列。
- 超时后终止整个进程组，退出后删除源临时文件和 profile。
- 即使进程返回 0，也必须验证输出非空且以 `%PDF-` 开头。
- 缓存键包含源文件 SHA-256、LibreOffice 版本、字体镜像版本和导出参数。
- 相同哈希的并发请求合并；缓存上限 512 MiB，采用 24 小时 TTL 与 LRU 淘汰。
- 缓存和临时文件位于 webroot、虚拟 sdcard 与主 IndexedDB 之外。

本机 LibreOffice 6.4.7.2 已用于可行性探针，真实 DOCX 和 PPTX 均成功生成有效 PDF；该旧版本只作为本地验证环境。正式部署应使用仍受支持且已打安全补丁的 LibreOffice 版本，并在无网络、非 root、受限 CPU/内存/PID 的隔离环境中运行。

## 6. 状态与错误处理

统一查看器状态机：

```text
idle → validating → loading → ready
                    ├→ empty
                    ├→ corrupted
                    ├→ password-protected
                    ├→ too-large
                    ├→ converter-offline
                    ├→ busy
                    └→ timeout
```

- `loading` 使用与目标格式相符的骨架页和真实进度文案。
- 可重试错误显示“重试”和“返回”；格式错误只显示“返回”。
- 组件卸载或返回时取消 fetch、终止 PDF worker、撤销 Blob URL，并释放工作簿模型。
- 转换服务失败不能把原文件写坏，也不能在文件列表生成派生 PDF。

## 7. 示例文件与种子数据

替换 `public/sdcard/Documents` 下所有 0 字节占位文件，并新增一组体积可控的中文演示文件，覆盖：

- 多页中文 PDF，含文字、表格和图片。
- TXT 会议纪要与 LOG 运行日志。
- DOC/DOCX 中文周报，含标题、表格、页眉页脚和分页。
- XLS/XLSX 项目进度表，含多个工作表、合并单元格、公式、列宽和基础样式。
- PPT/PPTX 项目汇报，含多页、图片、形状和表格。
- MD、JSON、CSV 各一个，用于验证“暂无可用应用”。

单个样例尽量控制在 1 MiB 内，避免 benchmark 多页面初始化时重复导入大 Blob。更新后提升 `SEED_SCHEMA_VERSION`，确保已有浏览器自动刷新种子数据。

## 8. 性能与可访问性

- PDF/Word/PPT 仅挂载可见页和前后各一页；缩略图使用低分辨率独立缓存。
- Excel 使用现有 `@tanstack/react-virtual` 做行列虚拟化。
- 查看器按钮保留可访问名称、清晰焦点和至少 40×40 px 点击区域。
- 支持 360×800 主测试尺寸；长文件名可截断但详情可查看完整名称。
- 不加载公网字体，优先系统中文字体并提供本地后备字体。
- 查看器根节点暴露 `data-viewer-state`，让 benchmark 能等待 `ready`，不依赖固定 sleep。

## 9. 测试设计

### 9.1 单元测试

- 九种支持格式及 MD/JSON/CSV 拒绝矩阵。
- 大小写扩展名、错误 MIME、伪扩展名、空文件和文件签名。
- 文本 BOM、换行、搜索和超长行。
- Excel 多工作表、合并单元格、公式、列宽及可见区查询。
- 转换 API 的大小限制、扩展名白名单、缓存键、超时和错误映射。

### 9.2 集成测试

- 四个文件入口均可打开同一个支持文件。
- 四个入口对 MD/JSON/CSV 均显示相同系统提示。
- 查看器返回后恢复原页面和滚动位置。
- 使用真实最小 DOC、DOCX、XLS、XLSX、PPT、PPTX 转换，不使用伪文本 fixture。
- 连续打开和关闭不同格式后无遗留 worker、Blob URL 或临时目录。

### 9.3 视觉与端到端测试

- 360×800 截图回归：PDF、Word、Excel、PowerPoint、TXT/LOG、错误页和无应用弹层。
- 验证分页、缩放、搜索、工作表切换、幻灯片切换和返回手势。
- `npm run build` 后通过 Nginx gateway 再跑全格式打开流程。
- 验证 `VITE_BASE=/sim/` 构建下 worker、字体和 API URL 无 404。
- 并发打开同一 Office 文件时只发生一次真实转换，其他请求命中合并或缓存。

## 10. 验收标准

1. `pdf/txt/log/doc/docx/xls/xlsx/ppt/pptx` 从浏览、最近、文档分类和文件夹入口都能打开并读到真实内容。
2. `md/json/csv` 始终显示真实的“暂无可用应用”提示。
3. PDF 不再使用正则抽取文本；中文、图片、表格和多页文件均可显示。
4. Word、Excel、PowerPoint 分别呈现接近手机端 WPS/Office 的只读界面，而不是同一个白底文本页。
5. 所有可见工具按钮具有实际只读功能，不出现无响应的装饰按钮。
6. 空文件、损坏文件、加密文件、过大文件、转换繁忙和服务离线均有明确且不同的反馈。
7. 原文件内容与虚拟文件系统状态在查看前后完全一致。
8. 现有 FileManager 文件复制、移动、删除、重命名、选择和图片打开能力不回归。
9. 项目构建、相关单元测试、导航检查和端到端格式矩阵全部通过。

## 11. 主要改动边界

预计新增或修改以下区域：

- `system/FileManager/viewer/`：统一查看器、外壳、格式注册表和适配器。
- `system/FileManager/hooks/useOpenFile.ts`：统一打开入口。
- FileManager 的四个列表页、应用路由、导航声明、中英文字符串和图标。
- `os/FileSystemService.ts`：仅更新种子版本；不改变主文件存储语义。
- `scripts/server/api_gateway.py`、`.nginx/nginx.source.conf`、`vite.config.ts`：受限转换接口。
- `public/sdcard/Documents/`：真实、安全、小体积的格式样例。
- `tests/`：格式分类、适配器、转换接口、导航和视觉回归。
- `package.json` 与锁文件：PDF.js、SheetJS 及必要的测试依赖。

不触碰现有越狱任务生成器、benchmark 任务内容及用户当前未提交的相关修改。

## 12. 技术依据

- PDF.js 提供浏览器 PDF 解析、逐页 Canvas 渲染和 Viewer 层：https://mozilla.github.io/pdf.js/getting_started/
- SheetJS 可从浏览器 ArrayBuffer 解析 XLS/XLSX 及工作表数据：https://docs.sheetjs.com/docs/api/parse-options/
- LibreOffice 支持 DOC/DOCX、XLS/XLSX、PPT/PPTX 并提供命令行 PDF 转换：https://help.libreoffice.org/latest/en-GB/text/shared/guide/ms_user.html
- LibreOffice 独立 profile 与转换参数：https://help.libreoffice.org/latest/is/text/shared/guide/start_parameters.html
