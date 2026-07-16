import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSNode } from '@/os/types';

const fsMock = vi.hoisted(() => ({
  getNode: vi.fn<(path: string) => FSNode | null>(),
  getNodeById: vi.fn<(id: string) => FSNode | null>(),
  readFileById: vi.fn<(id: string) => Promise<Blob | null>>(),
  writeFile: vi.fn<(path: string, content: Blob, options?: { mimeType?: string }) => Promise<FSNode>>(),
  deleteNode: vi.fn<(path: string) => Promise<boolean>>(),
  exists: vi.fn<(path: string) => boolean>(),
}));

vi.mock('@/os/FileSystemService', () => fsMock);

import {
  cloneFileForApp,
  clonePayloadForApp,
  createFileRef,
  createPayload,
  createSendIntent,
  createViewIntent,
  openAttachment,
  parseContentUri,
  parseIntent,
  resolveViewIntent,
  rollbackPrivateAttachments,
  toContentUri,
} from '@/os/FileShareService';

function fileNode(overrides: Partial<FSNode> = {}): FSNode {
  return {
    id: 'file-source',
    name: '季度报告.docx',
    type: 'file',
    parentId: 'docs',
    path: '/sdcard/Documents/季度报告.docx',
    size: 42,
    mimeType: '',
    createdAt: 10,
    modifiedAt: 20,
    storage: 'indexeddb',
    ...overrides,
  };
}

describe('FileShareService', () => {
  let byId: Map<string, FSNode>;
  let byPath: Map<string, FSNode>;
  let blobs: Map<string, Blob>;

  beforeEach(() => {
    vi.clearAllMocks();
    const source = fileNode();
    byId = new Map([[source.id, source]]);
    byPath = new Map([[source.path, source]]);
    blobs = new Map([[source.id, new Blob(['docx'], { type: 'application/octet-stream' })]]);
    fsMock.getNode.mockImplementation((path) => byPath.get(path) ?? null);
    fsMock.getNodeById.mockImplementation((id) => byId.get(id) ?? null);
    fsMock.readFileById.mockImplementation(async (id) => blobs.get(id) ?? null);
    fsMock.exists.mockReturnValue(false);
    fsMock.deleteNode.mockImplementation(async (path) => {
      const node = byPath.get(path);
      if (node) {
        byPath.delete(path);
        byId.delete(node.id);
        blobs.delete(node.id);
        return true;
      }
      const childPaths = [...byPath.keys()].filter((candidate) => candidate.startsWith(`${path}/`));
      for (const childPath of childPaths) {
        const child = byPath.get(childPath);
        byPath.delete(childPath);
        if (child) {
          byId.delete(child.id);
          blobs.delete(child.id);
        }
      }
      return childPaths.length > 0;
    });
    fsMock.writeFile.mockImplementation(async (path, content, options) => {
      const node = fileNode({
        id: 'file-copy',
        name: path.split('/').pop() || 'attachment',
        path,
        size: content.size,
        mimeType: options?.mimeType,
        modifiedAt: 30,
      });
      byId.set(node.id, node);
      byPath.set(node.path, node);
      blobs.set(node.id, content);
      return node;
    });
  });

  it('creates a stable content URI and infers Office MIME from the filename', () => {
    const payload = createPayload('/sdcard/Documents/季度报告.docx');

    expect(payload.files).toEqual([
      expect.objectContaining({
        version: 1,
        fileId: 'file-source',
        uri: 'content://simfs/files/file-source',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ]);
    expect(parseContentUri(toContentUri('id with space'))).toBe('id with space');
  });

  it('resolves canonical refs by id after the source is moved and renamed', () => {
    const payload = createPayload('/sdcard/Documents/季度报告.docx');
    const moved = fileNode({ name: '最终报告.docx', path: '/sdcard/Download/最终报告.docx' });
    byId.set(moved.id, moved);
    byPath.clear();
    byPath.set(moved.path, moved);

    const parsed = parseIntent(createSendIntent(payload));

    expect(parsed?.files[0]).toEqual(expect.objectContaining({
      fileId: 'file-source',
      uri: 'content://simfs/files/file-source',
      name: '最终报告.docx',
    }));
  });

  it('parses and deduplicates legacy stream, EXTRA_STREAM, path, and content URI forms', () => {
    const parsed = parseIntent({
      action: 'ACTION_SEND',
      type: 'application/*',
      data: {
        stream: ['/sdcard/Documents/季度报告.docx', 'content://simfs/files/file-source'],
        EXTRA_STREAM: '/sdcard/Documents/季度报告.docx',
        path: '/sdcard/Documents/季度报告.docx',
      },
    });

    expect(parsed?.files).toHaveLength(1);
    expect(parsed?.files[0].fileId).toBe('file-source');
    expect(parsed?.mimeType).toContain('wordprocessingml.document');
  });

  it('clones into the receiving App private attachment area', async () => {
    const copied = await cloneFileForApp('content://simfs/files/file-source', 'wechat');

    expect(fsMock.readFileById).toHaveBeenCalledWith('file-source');
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/data\/data\/wechat\/attachments\/att_[a-z0-9]+\/季度报告\.docx$/),
      expect.any(Blob),
      { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    );
    expect(copied).toEqual(expect.objectContaining({
      fileId: 'file-copy',
      uri: 'content://simfs/files/file-copy',
    }));

    // The receiver's copy remains readable even after the source disappears.
    byId.delete('file-source');
    blobs.delete('file-source');
    await expect(openAttachment(copied)).resolves.toEqual(expect.objectContaining({
      ref: expect.objectContaining({ fileId: 'file-copy' }),
      blob: expect.any(Blob),
    }));
  });

  it('creates an ACTION_VIEW payload carrying both stable and legacy data', () => {
    const intent = createViewIntent('/sdcard/Documents/季度报告.docx', { route: '/viewer?path=docx' });

    expect(intent).toEqual(expect.objectContaining({
      action: 'ACTION_VIEW',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      scheme: 'content',
      route: '/viewer?path=docx',
      data: expect.objectContaining({
        stream: 'content://simfs/files/file-source',
        path: '/sdcard/Documents/季度报告.docx',
        fileRef: expect.objectContaining({ fileId: 'file-source' }),
      }),
    }));
  });

  it('keeps the exact TXT MIME while the structured payload marks it as a file', () => {
    const txt = fileNode({
      id: 'txt-source',
      name: '会议纪要.txt',
      path: '/sdcard/Documents/会议纪要.txt',
      mimeType: 'text/plain',
    });
    byId.set(txt.id, txt);
    byPath.set(txt.path, txt);

    const payload = createPayload(txt.path);
    const intent = createSendIntent(payload);

    expect(payload.files[0].mimeType).toBe('text/plain');
    expect(intent.type).toBe('text/plain');
    expect(intent.data?.sharePayload.files).toHaveLength(1);
  });

  it('uses ACTION_SEND_MULTIPLE when more than one file is selected', () => {
    const second = fileNode({
      id: 'file-second',
      name: '演示文稿.pptx',
      path: '/sdcard/Documents/演示文稿.pptx',
    });
    byId.set(second.id, second);
    byPath.set(second.path, second);

    const intent = createSendIntent(createPayload([
      '/sdcard/Documents/季度报告.docx',
      second.path,
    ]));

    expect(intent.action).toBe('ACTION_SEND_MULTIPLE');
    expect(intent.type).toBe('application/*');
    expect(intent.data?.stream).toEqual([
      'content://simfs/files/file-source',
      'content://simfs/files/file-second',
    ]);
  });

  it('uses */* for a mixed image and document selection', () => {
    const image = fileNode({
      id: 'image-source',
      name: '现场.png',
      path: '/sdcard/Pictures/现场.png',
      mimeType: 'image/png',
    });
    byId.set(image.id, image);
    byPath.set(image.path, image);

    const intent = createSendIntent(createPayload([
      '/sdcard/Documents/季度报告.docx',
      image.path,
    ]));

    expect(intent.type).toBe('*/*');
  });

  it('requires a target-bound grant for private ACTION_VIEW attachments', async () => {
    const copied = await cloneFileForApp('/sdcard/Documents/季度报告.docx', 'wechat');
    const intent = createViewIntent(copied, { targetAppId: 'file_manager' });

    expect(intent?.data?.path).toBeUndefined();
    expect(intent?.data?.fileRef?.path).toBeUndefined();
    expect(intent?.data?.grantToken).toEqual(expect.any(String));
    expect(resolveViewIntent(intent, 'file_manager')?.ref.fileId).toBe(copied.fileId);
    expect(resolveViewIntent(intent, 'gallery')).toBeNull();
    expect(resolveViewIntent({
      action: 'ACTION_VIEW',
      type: copied.mimeType,
      data: { fileRef: copied, path: '/data/data/wechat/attachments/att_fake/季度报告.docx' },
    }, 'file_manager')).toBeNull();
  });

  it('never accepts or serializes a raw App-private path', async () => {
    const copied = await cloneFileForApp('/sdcard/Documents/季度报告.docx', 'wechat');
    const privatePath = byId.get(copied.fileId)?.path;

    expect(copied.path).toBeUndefined();
    expect(createFileRef(privatePath ?? '')).toBeNull();
    expect(() => createPayload(privatePath ?? '')).toThrow(
      'Cannot share a missing file or directory',
    );
    expect(parseIntent({
      action: 'ACTION_SEND',
      type: copied.mimeType,
      data: { stream: privatePath, path: privatePath },
    })).toBeNull();
    const parsedPrivateRef = parseIntent(createSendIntent(createPayload(copied)))?.files[0];
    expect(parsedPrivateRef?.fileId).toBe(copied.fileId);
    expect(parsedPrivateRef?.path).toBeUndefined();
  });

  it('rejects non-canonical raw App-private paths with repeated slashes', async () => {
    const copied = await cloneFileForApp('/sdcard/Documents/季度报告.docx', 'wechat');
    const privatePath = byId.get(copied.fileId)?.path;
    const disguisedPrivatePath = privatePath?.replace('/data/data/', '//data//data/');

    expect(disguisedPrivatePath).toContain('//data//data/');
    expect(parseIntent({
      action: 'ACTION_SEND',
      type: copied.mimeType,
      data: { stream: disguisedPrivatePath, path: disguisedPrivatePath },
    })).toBeNull();
  });

  it('removes only uncommitted copies from the target App attachment root', async () => {
    const copied = await cloneFileForApp('/sdcard/Documents/季度报告.docx', 'mail');
    const path = byId.get(copied.fileId)?.path;

    await rollbackPrivateAttachments([copied], 'mail');

    expect(path).toBeTruthy();
    expect(fsMock.deleteNode).toHaveBeenCalledWith(path);
    expect(fsMock.deleteNode).toHaveBeenCalledWith(path?.slice(0, path.lastIndexOf('/')));
  });

  it('pre-reads every source before writing any private attachment', async () => {
    const second = fileNode({
      id: 'file-second',
      name: '演示文稿.pptx',
      path: '/sdcard/Documents/演示文稿.pptx',
    });
    byId.set(second.id, second);
    byPath.set(second.path, second);
    // The metadata still exists, but the second file's bytes disappeared.
    blobs.delete(second.id);

    const payload = createPayload([
      '/sdcard/Documents/季度报告.docx',
      second.path,
    ]);

    await expect(clonePayloadForApp(payload, 'wechat')).rejects.toThrow(
      'Source file content is unavailable',
    );
    expect(fsMock.readFileById).toHaveBeenCalledWith('file-source');
    expect(fsMock.readFileById).toHaveBeenCalledWith('file-second');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(fsMock.deleteNode).not.toHaveBeenCalled();
  });

  it('rolls back every attempted private path when a later write fails', async () => {
    const second = fileNode({
      id: 'file-second',
      name: '演示文稿.pptx',
      path: '/sdcard/Documents/演示文稿.pptx',
    });
    byId.set(second.id, second);
    byPath.set(second.path, second);
    blobs.set(second.id, new Blob(['pptx'], { type: 'application/octet-stream' }));

    let writes = 0;
    fsMock.writeFile.mockImplementation(async (path, content, options) => {
      writes += 1;
      const node = fileNode({
        id: `private-copy-${writes}`,
        name: path.split('/').pop() || 'attachment',
        path,
        size: content.size,
        mimeType: options?.mimeType,
        modifiedAt: 30 + writes,
      });
      // Simulate a backend that materialises the second path before failing.
      byId.set(node.id, node);
      byPath.set(path, node);
      blobs.set(node.id, content);
      if (writes === 2) throw new Error('disk full');
      return node;
    });

    const payload = createPayload([
      '/sdcard/Documents/季度报告.docx',
      second.path,
    ]);

    await expect(clonePayloadForApp(payload, 'mail')).rejects.toThrow('disk full');
    expect(fsMock.deleteNode).toHaveBeenCalledTimes(4);
    expect(fsMock.deleteNode).toHaveBeenCalledWith(expect.stringMatching(
      /^\/data\/data\/mail\/attachments\/att_[a-z0-9]+$/,
    ));
    expect([...byPath.keys()].filter((path) => path.startsWith('/data/data/mail/attachments/'))).toEqual([]);
  });
});
