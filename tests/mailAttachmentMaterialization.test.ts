import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSNode } from '@/os/types';
import type { FileRefV1 } from '@/os/types/fileShare';

const shareMock = vi.hoisted(() => ({
  resolveFileRef: vi.fn(),
  createPayload: vi.fn((files) => ({ version: 1, files, mimeType: 'application/octet-stream' })),
  clonePayloadForApp: vi.fn(),
}));

vi.mock('@/os/FileShareService', () => shareMock);

import { materializeMailAttachments } from '@/apps/Mail/utils/materializeAttachments';

function ref(fileId: string): FileRefV1 {
  return {
    version: 1,
    fileId,
    uri: `content://simfs/files/${fileId}`,
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 12,
    modifiedAt: 1,
  };
}

function node(fileRef: FileRefV1, path: string): FSNode {
  return {
    id: fileRef.fileId,
    name: fileRef.name,
    type: 'file',
    parentId: 'parent',
    path,
    size: fileRef.size,
    mimeType: fileRef.mimeType,
    createdAt: 1,
    modifiedAt: fileRef.modifiedAt,
    storage: 'indexeddb',
  };
}

describe('Mail attachment materialization', () => {
  const source = ref('source-file');
  const saved = ref('mail-copy');

  beforeEach(() => {
    vi.clearAllMocks();
    shareMock.resolveFileRef.mockImplementation((input: FileRefV1) => {
      if (input.fileId === source.fileId) {
        return { ref: source, node: node(source, '/sdcard/Documents/report.pdf') };
      }
      if (input.fileId === saved.fileId) {
        return { ref: saved, node: node(saved, '/data/data/mail/attachments/att_1/report.pdf') };
      }
      return null;
    });
    shareMock.clonePayloadForApp.mockResolvedValue({
      version: 1,
      files: [saved],
      mimeType: saved.mimeType,
    });
  });

  it('clones each unique source once even when attached more than once', async () => {
    const result = await materializeMailAttachments([
      { id: 'one', uri: source.uri, fileRef: source },
      { id: 'two', uri: source.uri, fileRef: source },
    ]);

    expect(shareMock.clonePayloadForApp).toHaveBeenCalledTimes(1);
    expect(shareMock.createPayload).toHaveBeenCalledWith([source]);
    expect(result.map((item) => item.fileRef?.fileId)).toEqual(['mail-copy', 'mail-copy']);
  });

  it('reuses an existing Mail-private copy on later save/send', async () => {
    const result = await materializeMailAttachments([{ id: 'saved', fileRef: saved }]);

    expect(shareMock.clonePayloadForApp).not.toHaveBeenCalled();
    expect(result[0]).toEqual(expect.objectContaining({ uri: saved.uri, fileRef: saved }));
  });

  it('fails instead of silently saving a dangling source ref', async () => {
    const missing = ref('missing');
    await expect(materializeMailAttachments([{ id: 'missing', fileRef: missing }]))
      .rejects.toThrow('no longer exists');
  });
});
