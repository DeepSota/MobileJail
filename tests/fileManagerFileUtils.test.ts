import { describe, expect, it } from 'vitest';
import {
  isPdfPreviewableFile,
  isTextPreviewableFile,
} from '../system/FileManager/utils/fileUtils';
import {
  classifyFileFormat,
  isDocumentLikeFile,
  isSupportedDocument,
} from '../system/FileManager/viewer/fileFormatRegistry';
import { getFileOpenTarget } from '../system/FileManager/hooks/useOpenFile';
import type { FSNode } from '../os/types';

function node(overrides: Partial<FSNode> = {}): FSNode {
  const name = overrides.name ?? 'note.txt';
  return {
    id: overrides.id ?? name,
    name,
    type: overrides.type ?? 'file',
    parentId: overrides.parentId ?? null,
    path: overrides.path ?? `/sdcard/Download/${name}`,
    size: overrides.size ?? 12,
    mimeType: overrides.mimeType,
    createdAt: overrides.createdAt ?? 1,
    modifiedAt: overrides.modifiedAt ?? 1,
    storage: overrides.storage ?? 'memory',
  };
}

describe('FileManager fileUtils', () => {
  describe('PDF preview', () => {
    it('recognizes pdf files as previewable', () => {
      expect(isPdfPreviewableFile(node({ name: 'document.pdf', mimeType: 'application/pdf' }))).toBe(true);
      expect(isPdfPreviewableFile(node({ name: 'quote.PDF', mimeType: 'application/octet-stream' }))).toBe(true);
    });
  });

  describe('Text preview', () => {
    it('只允许 TXT、LOG 和 text/plain MIME 进入文本查看器', () => {
      expect(isTextPreviewableFile(node({ name: 'note.txt' }))).toBe(true);
      expect(isTextPreviewableFile(node({ name: 'raw_login.log' }))).toBe(true);
      expect(isTextPreviewableFile(node({ name: 'README', mimeType: 'text/plain' }))).toBe(true);
    });

    it('明确拒绝 MD、JSON、CSV、目录和其他文件', () => {
      expect(isTextPreviewableFile(node({ name: 'README.md', mimeType: 'text/plain' }))).toBe(false);
      expect(isTextPreviewableFile(node({ name: 'data.json', mimeType: 'text/plain' }))).toBe(false);
      expect(isTextPreviewableFile(node({ name: 'table.csv', mimeType: 'text/plain' }))).toBe(false);
      expect(isTextPreviewableFile(node({ name: 'logs', type: 'directory' }))).toBe(false);
      expect(isTextPreviewableFile(node({ name: 'contract.pdf', mimeType: 'application/pdf' }))).toBe(false);
      expect(isTextPreviewableFile(node({ name: 'photo.txt.jpg', mimeType: 'image/jpeg' }))).toBe(false);
    });
  });

  describe('统一格式注册表', () => {
    it.each([
      ['report.pdf', 'pdf'],
      ['note.txt', 'text'],
      ['service.LOG', 'text'],
      ['legacy.doc', 'word'],
      ['weekly.DOCX', 'word'],
      ['legacy.xls', 'spreadsheet'],
      ['budget.XLSX', 'spreadsheet'],
      ['legacy.ppt', 'presentation'],
      ['slides.PPTX', 'presentation'],
    ])('支持 %s 并分类为 %s', (name, kind) => {
      const file = node({ name, mimeType: 'application/octet-stream' });
      expect(classifyFileFormat(file).kind).toBe(kind);
      expect(isSupportedDocument(file)).toBe(true);
      expect(isDocumentLikeFile(file)).toBe(true);
    });

    it.each(['README.md', 'payload.JSON', 'records.csv'])(
      '%s 始终分类为不支持，不能被 text MIME 误判',
      name => {
        const file = node({ name, mimeType: 'text/plain' });
        expect(classifyFileFormat(file).kind).toBe('unsupported');
        expect(isSupportedDocument(file)).toBe(false);
        expect(isDocumentLikeFile(file)).toBe(true);
      },
    );

    it('仅在没有注册扩展名时使用规范 MIME 作为辅助判断', () => {
      expect(classifyFileFormat(node({ name: 'download', mimeType: 'application/pdf' })).kind).toBe('pdf');
      expect(classifyFileFormat(node({ name: 'unknown.bin', mimeType: 'application/pdf' })).kind).toBe('unsupported');
      expect(classifyFileFormat(node({ name: 'data.json', mimeType: 'application/pdf' })).kind).toBe('unsupported');
    });
  });

  describe('统一打开目标', () => {
    it('目录、图片、支持文档和不支持文档分别进入正确目标', () => {
      expect(getFileOpenTarget(node({ name: 'Documents', type: 'directory' }))).toBe('folder');
      expect(getFileOpenTarget(node({ name: 'photo.jpg', mimeType: 'image/jpeg' }))).toBe('image');
      expect(getFileOpenTarget(node({ name: 'report.docx' }))).toBe('viewer');
      expect(getFileOpenTarget(node({ name: 'README.md', mimeType: 'text/plain' }))).toBe('unsupported');
    });
  });
});
