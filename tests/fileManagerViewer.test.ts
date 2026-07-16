import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../os/NetworkService', () => ({
  netFetch: vi.fn(),
}));

import { netFetch } from '../os/NetworkService';
import { FILE_FORMAT_REGISTRY } from '../system/FileManager/viewer/fileFormatRegistry';
import {
  getOfficePreviewErrorKey,
  OfficePreviewRequestError,
  requestOfficePdf,
} from '../system/FileManager/viewer/officePreviewClient';

describe('FileManager 统一文档查看器', () => {
  beforeEach(() => vi.mocked(netFetch).mockReset());

  it('注册 /viewer 路由并将所有受支持文档统一导入该路由', () => {
    const app = readFileSync('system/FileManager/FileManagerApp.tsx', 'utf8');
    const nav = readFileSync('system/FileManager/navigation.declaration.ts', 'utf8');
    const hook = readFileSync('system/FileManager/hooks/useOpenFile.ts', 'utf8');
    expect(app).toContain('<Route path="/viewer" element={<ViewerPage />} />');
    expect(nav).toContain("path: '/viewer'");
    expect(nav).toContain("id: 'file.viewer.open'");
    expect(hook).toContain("go('file.viewer.open', { path: node.path })");
  });

  it('PDF 使用 PDF.js canvas，Excel 使用 SheetJS，Word/PPT 使用 Office 转 PDF 客户端', () => {
    const pdf = readFileSync('system/FileManager/viewer/PdfDocumentView.tsx', 'utf8');
    const spreadsheet = readFileSync('system/FileManager/viewer/SpreadsheetView.tsx', 'utf8');
    const office = readFileSync('system/FileManager/viewer/OfficeDocumentView.tsx', 'utf8');
    expect(pdf).toContain("from 'pdfjs-dist'");
    expect(pdf).toContain('page.render({');
    expect(pdf).toContain('pdf.worker.min.mjs?url');
    expect(spreadsheet).toContain("import('xlsx')");
    expect(spreadsheet).toContain('buildSpreadsheetGrid');
    expect(spreadsheet).toContain('cellFormula: true');
    expect(office).toContain('requestOfficePdf');
    expect(office).toContain('<PdfDocumentView');
  });

  it('查看器提供搜索、缩略图、缩放、工作表切换和分享声明', () => {
    const nav = readFileSync('system/FileManager/navigation.declaration.ts', 'utf8');
    for (const id of [
      'viewer.search.open',
      'viewer.thumbnails.open',
      'viewer.search.query',
      'viewer.zoom.set',
      'viewer.page.set',
      'viewer.sheet.select',
      'viewer.file.share',
    ]) {
      expect(nav).toContain(`id: '${id}'`);
    }
  });

  it('查看器根节点暴露可等待的真实状态和格式标记', () => {
    const viewer = readFileSync('system/FileManager/pages/ViewerPage.tsx', 'utf8');
    const pdf = readFileSync('system/FileManager/viewer/PdfDocumentView.tsx', 'utf8');
    const office = readFileSync('system/FileManager/viewer/OfficeDocumentView.tsx', 'utf8');
    expect(viewer).toContain('data-viewer-state={viewerState}');
    expect(viewer).toContain('data-viewer-kind={format.kind}');
    expect(pdf).toContain("onStateChange('password-protected')");
    expect(office).toContain("? 'converter-offline'");
  });

  it('文件列表和查看器分享统一使用 content URI 载荷', () => {
    const operations = readFileSync('system/FileManager/utils/fileOperations.ts', 'utf8');
    const browse = readFileSync('system/FileManager/pages/BrowseHomePage.tsx', 'utf8');
    expect(operations).toContain('FileShareService.createPayload(files)');
    expect(operations).toContain('FileShareService.createSendIntent(payload)');
    expect(browse).toContain('shareNodes(getSelectedNodes())');
    expect(browse).toContain('data-action="browse.select.send"');
  });

  it('Office 预览客户端传送原始文件并验证 PDF 响应', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    vi.mocked(netFetch).mockResolvedValue(new Response(pdf, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }));
    const source = new Blob(['docx bytes']);
    const result = await requestOfficePdf(source, FILE_FORMAT_REGISTRY.docx);
    expect(Array.from(result.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(netFetch).toHaveBeenCalledWith('/api/preview/office', expect.objectContaining({
      method: 'POST',
      body: source,
      headers: expect.objectContaining({ 'X-File-Extension': 'docx' }),
    }));
  });

  it('Office 预览客户端拒绝伪 PDF 响应', async () => {
    vi.mocked(netFetch).mockResolvedValue(new Response('not a pdf', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }));
    await expect(requestOfficePdf(new Blob(['docx']), FILE_FORMAT_REGISTRY.docx))
      .rejects.toMatchObject<Partial<OfficePreviewRequestError>>({ code: 'INVALID_RESPONSE' });
  });

  it('Office 预览客户端在上传前识别密码保护并使用独立错误文案', async () => {
    const encrypted = Buffer.concat([
      Buffer.from('d0cf11e0a1b11ae1', 'hex'),
      Buffer.alloc(32),
      Buffer.from('EncryptionInfo', 'utf16le'),
      Buffer.alloc(16),
      Buffer.from('EncryptedPackage', 'utf16le'),
    ]);
    await expect(requestOfficePdf(new Blob([encrypted]), FILE_FORMAT_REGISTRY.docx))
      .rejects.toMatchObject<Partial<OfficePreviewRequestError>>({ code: 'PASSWORD_PROTECTED' });
    expect(netFetch).not.toHaveBeenCalled();
    expect(getOfficePreviewErrorKey(
      new OfficePreviewRequestError('PASSWORD_PROTECTED', 'locked', 423),
    )).toBe('viewer_error_password');
  });

  it('文本换行和 Excel 单元格选择使用 URL transition', () => {
    const nav = readFileSync('system/FileManager/navigation.declaration.ts', 'utf8');
    const text = readFileSync('system/FileManager/viewer/TextDocumentView.tsx', 'utf8');
    const sheet = readFileSync('system/FileManager/viewer/SpreadsheetView.tsx', 'utf8');
    expect(nav).toContain("id: 'viewer.text.wrap.set'");
    expect(nav).toContain("id: 'viewer.cell.select'");
    expect(text).toContain("bindTap('viewer.text.wrap.set'");
    expect(sheet).toContain("bindTap('viewer.cell.select'");
  });
});
