import { beforeEach, describe, expect, it } from 'vitest';
import { useMeetingStore } from '@/apps/TencentMeeting/state';
import type { FileRefV1 } from '@/os/types/fileShare';

const attachment: FileRefV1 = {
  version: 1,
  fileId: 'meeting-private-file',
  uri: 'content://simfs/files/meeting-private-file',
  name: '会议材料.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  modifiedAt: 1,
};

describe('Tencent Meeting shared-file delivery guards', () => {
  beforeEach(() => {
    useMeetingStore.setState({
      activeMeeting: null,
      pendingMeetingConfig: null,
      currentScheduledMeeting: null,
    });
    useMeetingStore.getState().startMeeting({ isHost: true });
  });

  it('only appends files to the meeting that initiated the share flow', () => {
    const meeting = useMeetingStore.getState().activeMeeting;
    expect(meeting).not.toBeNull();

    expect(useMeetingStore.getState().sendChatFiles(
      [attachment],
      'all',
      'Everyone',
      'a-different-meeting',
    )).toBe(false);
    expect(useMeetingStore.getState().activeMeeting?.chatMessages ?? []).toHaveLength(0);

    expect(useMeetingStore.getState().sendChatFiles(
      [attachment],
      'all',
      'Everyone',
      meeting!.id,
    )).toBe(true);
    expect(useMeetingStore.getState().activeMeeting?.chatMessages).toEqual([
      expect.objectContaining({ fileRef: attachment, toId: 'all' }),
    ]);
  });

  it('never falls back to everyone when a private recipient is unavailable', () => {
    const meeting = useMeetingStore.getState().activeMeeting!;

    expect(useMeetingStore.getState().sendChatFiles(
      [attachment],
      'participant-who-left',
      'Former participant',
      meeting.id,
    )).toBe(false);
    expect(useMeetingStore.getState().activeMeeting?.chatMessages ?? []).toHaveLength(0);
  });
});
