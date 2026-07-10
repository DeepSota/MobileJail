# MobileJail 高拟真文件查看器实施计划

设计依据：`docs/superpowers/specs/2026-07-10-realistic-document-viewer-design.md`

## 约束

- 只改 `mobilejail`，不改 `mobilegym-main`。
- 保留并避开现有越狱任务相关未提交改动。
- 支持 `pdf/txt/log/doc/docx/xls/xlsx/ppt/pptx`；`md/json/csv` 显示无可用应用。
- 所有查看器只读，分享原文件，不写回派生预览。
- 所有格式从 Browse、Folder、Recent、Category 共用一个打开入口。

## 任务 1：格式注册与打开入口

新增：

- `system/FileManager/viewer/fileFormatRegistry.ts`
- `system/FileManager/hooks/useOpenFile.ts`
- `system/FileManager/components/UnsupportedFileSheet.tsx`

修改四个列表页，统一目录、图片、文档和不支持格式的点击行为。补格式矩阵、大小写扩展名、MIME 与文件签名单元测试。

## 任务 2：统一查看器与导航

新增：

- `system/FileManager/viewer/DocumentViewerPage.tsx`
- `system/FileManager/viewer/DocumentViewerShell.tsx`
- `system/FileManager/viewer/viewerTypes.ts`
- `system/FileManager/viewer/viewerIcons.tsx`

新增 `/viewer?path=...` 路由与导航声明，覆盖四个入口。实现 loading、ready、empty、corrupted、password-protected、too-large、converter-offline、busy、timeout 状态。

## 任务 3：PDF 与文本查看

- 安装并动态导入 `pdfjs-dist`。
- 实现 PDF worker、按页 Canvas、文字层搜索、可见页渲染、缩略图、页码和缩放。
- 实现 TXT/LOG 行号、UTF-8/BOM/GB18030 解码、搜索、换行和字号。
- 删除现有 PDF 正则抽取逻辑，并让旧 `/pdf`、`/text` 路径统一到新查看器或移除。

## 任务 4：Excel 查看

- 安装并动态导入 SheetJS。
- 解析 XLS/XLSX 的工作表、合并区域、公式、基础格式、列宽和行高。
- 用 `@tanstack/react-virtual` 渲染可见行，提供工作表标签、名称框、公式栏、单元格选择、搜索与缩放。
- 页面视图按需调用 Office 预览 API。

## 任务 5：Office 页面转换服务

修改：

- `scripts/server/api_gateway.py`
- `.nginx/nginx.source.conf`
- `vite.config.ts`

新增原始 Blob `POST /api/preview/office`，实现 25 MiB 限制、扩展名与魔数校验、独立 profile、45 秒超时、全局并发 2、SHA-256 缓存、PDF 输出验证与错误码。Vite 开发中间件与 Starlette 保持同一请求/响应契约。

## 任务 6：Word 与 PowerPoint 查看

- DOC/DOCX 通过转换服务获得 PDF 页面，使用 Word 蓝色外壳、纸张分页、缩略图、搜索和缩放。
- PPT/PPTX 使用相同页面源，使用 PowerPoint 橙色外壳、左侧缩略图、上一页/下一页和适应屏幕。
- 转换服务不可用时显示可重试的独立错误状态。

## 任务 7：真实演示文件与种子

在 `public/sdcard/Documents` 生成安全、非空、小体积中文样例：PDF、TXT、LOG、DOC、DOCX、XLS、XLSX、PPT、PPTX、MD、JSON、CSV。更新 `SEED_SCHEMA_VERSION`，确保已存在的浏览器数据刷新。

## 任务 8：测试与验证

新增/更新：

- 格式注册与入口测试。
- PDF/text/spreadsheet 纯模型测试。
- Python 转换 API 单元与真实格式 smoke test。
- 360×800 Puppeteer 全格式打开测试和截图。

依次运行：

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
python -m pytest <document preview tests>
```

随后启动 Nginx gateway，逐格式验证打开、分页、缩放、搜索、工作表/幻灯片切换、返回和错误提示。

## 任务 9：提交隔离

- 将 `.superpowers/` 加入 `.gitignore`。
- 只暂存本计划和文件查看器相关文件。
- 用 `git diff --cached --name-only` 证明未包含用户原有越狱任务改动。
