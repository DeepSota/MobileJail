import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ENTRY_POINT_SOURCES = [
  'system/FileManager/pages/BrowseHomePage.tsx',
  'system/FileManager/pages/FolderPage.tsx',
  'system/FileManager/pages/RecentPage.tsx',
  'system/FileManager/pages/CategoryPage.tsx',
];

describe('FileManager 统一文件打开入口', () => {
  it('四个文件入口均复用 useOpenFile 和系统无可用应用弹层', () => {
    for (const path of ENTRY_POINT_SOURCES) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toContain('useOpenFile()');
      expect(source, path).toContain('openFile(item)');
      expect(source, path).toContain('<UnsupportedFileSheet');
    }
  });

  it('支持文档统一使用 file.viewer.open，图片仍使用 ACTION_VIEW', () => {
    const hookSource = readFileSync('system/FileManager/hooks/useOpenFile.ts', 'utf8');
    expect(hookSource).toContain("go('file.viewer.open', { path: node.path })");
    expect(hookSource).toContain("go('folder.open', { path: node.path })");
    expect(hookSource).toContain('createViewIntent(node');
  });

  it('最近页从整个虚拟文件系统收集文件并按修改时间排序', () => {
    const source = readFileSync('system/FileManager/pages/RecentPage.tsx', 'utf8');
    expect(source).toContain("FileSystem.searchFiles('', { type: 'file' })");
    expect(source).toContain("!file.path.startsWith('/data/data/')");
    expect(source).toContain('b.modifiedAt - a.modifiedAt');
    expect(source).not.toContain('FileSystem.getMediaFiles()');
    expect(source).not.toContain("FileSystem.getFilesByPath('/sdcard/Download')");
  });

  it('文档分类依据格式注册表同时呈现支持与明确拒绝的格式', () => {
    const source = readFileSync('system/FileManager/pages/CategoryPage.tsx', 'utf8');
    expect(source).toContain("category === 'documents'");
    expect(source).toContain('.filter(isDocumentLikeFile)');
    expect(source).toContain("!file.path.startsWith('/data/data/')");
  });

  it('不支持弹层展示完整文件名并使用 i18n 资源', () => {
    const source = readFileSync('system/FileManager/components/UnsupportedFileSheet.tsx', 'utf8');
    expect(source).toContain('{file.name}');
    expect(source).toContain('s.unsupported_file_message');
    expect(source).toContain('s.dialog_cancel');
  });

  it('不支持文件弹层由 URL 状态驱动并通过系统返回关闭', () => {
    const hookSource = readFileSync('system/FileManager/hooks/useOpenFile.ts', 'utf8');
    const navSource = readFileSync('system/FileManager/navigation.declaration.ts', 'utf8');
    expect(hookSource).not.toContain('useState');
    expect(hookSource).toContain("params.get('modal') !== 'unsupported'");
    expect(hookSource).toContain("go('folder.file.unsupported.open'");
    expect(hookSource).toContain('if (unsupportedFile) back()');
    expect(navSource).toContain("id: 'folder.modal.unsupported'");
    expect(navSource).toContain("id: 'category.file.unsupported.open'");
  });
});
