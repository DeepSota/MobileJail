import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRefV1 } from '@/os/types/fileShare';

type ProviderModule = typeof import('@/os/providers/MailProvider');
type ResolverModule = typeof import('@/os/ContentResolver');

let providerModule: ProviderModule;
let resolverModule: ResolverModule;

beforeAll(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  });
  providerModule = await import('@/os/providers/MailProvider');
  resolverModule = await import('@/os/ContentResolver');
});

beforeEach(() => {
  providerModule.useMailProviderStore.setState({
    accounts: [],
    folders: [],
    messages: [],
    attachments: [],
  }, true);
  providerModule.ensureMailProviderRegistered();
});

const fileRef: FileRefV1 = {
  version: 1,
  fileId: 'mail-private-file',
  uri: 'content://simfs/files/mail-private-file',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  size: 99,
  modifiedAt: 10,
};

describe('MailProvider FileRef persistence', () => {
  it('persists a complete stable fileRef and canonical content URI', () => {
    const messageId = providerModule.saveDraft({
      to: ['reader@example.com'],
      subject: 'Report',
      body: '',
      attachments: [{
        name: fileRef.name,
        type: 'document',
        mimeType: fileRef.mimeType,
        size: fileRef.size,
        uri: '/legacy/path.pdf',
        fileRef,
      }],
    });

    const attachments = resolverModule.default.query<any>(
      `content://mail/attachments?message=${messageId}`,
    ).items;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].uri).toBe(fileRef.uri);
    expect(attachments[0].fileRef).toEqual(fileRef);
  });

  it('replaces draft rows without duplicating the persisted attachment', () => {
    const input = {
      to: ['reader@example.com'],
      subject: 'Report',
      body: '',
      attachments: [{
        name: fileRef.name,
        type: 'document' as const,
        mimeType: fileRef.mimeType,
        size: fileRef.size,
        fileRef,
      }],
    };
    const messageId = providerModule.saveDraft(input);
    providerModule.saveDraft({ ...input, id: messageId });

    const attachments = resolverModule.default.query<any>(
      `content://mail/attachments?message=${messageId}`,
    ).items;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileRef.fileId).toBe(fileRef.fileId);
  });
});

