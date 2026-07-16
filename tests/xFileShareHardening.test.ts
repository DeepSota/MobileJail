import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRefV1 } from '@/os/types/fileShare';
import type { XConversation } from '@/apps/X/types';

const serviceMocks = vi.hoisted(() => ({
  rollbackPrivateAttachments: vi.fn(),
}));

vi.mock('@/os/FileShareService', () => ({
  rollbackPrivateAttachments: serviceMocks.rollbackPrivateAttachments,
}));

import { useXStore } from '@/apps/X/state';
import { removeUnsentSharedAttachments } from '@/apps/X/utils/sharedAttachmentCleanup';
import { strings } from '@/apps/X/res/strings';
import { stringsEn } from '@/apps/X/res/strings.en';

const attachment: FileRefV1 = {
  version: 1,
  fileId: 'x-private-file',
  uri: 'content://simfs/files/x-private-file',
  name: 'roadmap.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  modifiedAt: 1,
};

const conversation: XConversation = {
  id: 'conversation-1',
  participantId: 'friend-1',
  lastMessageId: 'old-message',
  unreadCount: 0,
  messages: [],
};

describe('X shared-file delivery hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useXStore.setState({ conversations: [{ ...conversation, messages: [] }] });
  });

  it('returns true and appends attachments when the conversation still exists', () => {
    const sent = useXStore.getState().sendSharedFiles(conversation.id, [attachment]);

    expect(sent).toBe(true);
    expect(useXStore.getState().conversations[0].messages).toEqual([
      expect.objectContaining({ fileRef: attachment, receiverId: conversation.participantId }),
    ]);
  });

  it('returns false without mutating state when the conversation disappeared', () => {
    const before = useXStore.getState().conversations;

    expect(useXStore.getState().sendSharedFiles('missing-conversation', [attachment])).toBe(false);
    expect(useXStore.getState().conversations).toBe(before);
  });

  it('removes both an unsent private file and its unique attachment directory', async () => {
    serviceMocks.rollbackPrivateAttachments.mockResolvedValue(undefined);

    await expect(removeUnsentSharedAttachments([attachment])).resolves.toBe(true);
    expect(serviceMocks.rollbackPrivateAttachments).toHaveBeenCalledWith([attachment], 'x');
  });

  it('provides localized feedback for a recipient race', () => {
    expect(strings.share_file_recipient_unavailable).toContain('接收');
    expect(stringsEn.share_file_recipient_unavailable).toContain('recipient');
  });

  it('keeps the share page open and cleans copied files when delivery is rejected', () => {
    const source = readFileSync('apps/X/pages/ShareFilePage.tsx', 'utf8');

    expect(source).toContain('sendSharedFilesToRecipient({');
    expect(source).toContain("await rollbackPrivateAttachments(savedPayload.files, 'x')");
    expect(source).toContain('s.share_file_recipient_unavailable');
    expect(source.indexOf('if (conversationId)')).toBeLessThan(source.indexOf("go('share.file.send'"));
  });
});
