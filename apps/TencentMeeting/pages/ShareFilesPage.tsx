import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useActivityContext } from '@/os/ActivityContext';
import {
  clonePayloadForApp,
  parseIntent as parseFileShareIntent,
  rollbackPrivateAttachments,
} from '@/os/FileShareService';
import { useActivityBackBlocker } from '@/os/hooks/useActivityBackBlocker';
import { IcCheck, IcFile, IcNavBack } from '../res/icons';
import { useMeetingStore } from '../state';
import { useMeetingGestures } from '../hooks/useMeetingGestures';
import { useTencentMeetingStrings } from '../hooks/useTencentMeetingStrings';
import type { SharePayloadV1 } from '@/os/types/fileShare';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** ACTION_SEND receiver for an active meeting's chat. */
export const ShareFilesPage: React.FC = () => {
  const s = useTencentMeetingStrings();
  const { activityId } = useActivityContext();
  const { bindBack, bindTap, go } = useMeetingGestures();
  const activeMeeting = useMeetingStore(state => state.activeMeeting);
  const user = useMeetingStore(state => state.user);
  const sendChatFiles = useMeetingStore(state => state.sendChatFiles);
  const [recipientId, setRecipientId] = useState('all');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const sendingRef = useRef(false);
  const sourceMeetingIdRef = useRef(activeMeeting?.id ?? '');
  const sourceMeetingId = sourceMeetingIdRef.current;
  useActivityBackBlocker('tencentMeeting.fileShare', sending);

  const payload = useMemo(() => {
    const os = window.__OS__;
    return parseFileShareIntent(
      os?.getIntentPayload?.(activityId) ?? os?.getIntentPayload?.('tencent_meeting'),
    );
  }, [activityId]);

  const meetingIsCurrent = Boolean(sourceMeetingId && activeMeeting?.id === sourceMeetingId);
  const participants = meetingIsCurrent
    ? activeMeeting!.participants.filter(participant => participant.id !== user.id)
    : [];
  const selected = participants.find(participant => participant.id === recipientId);
  const recipientIsValid = recipientId === 'all' || Boolean(selected);

  useEffect(() => {
    if (!meetingIsCurrent || !recipientId || recipientId === 'all' || selected) return;
    // Never expand an invalid private target to everyone. Clear it and require
    // the user to make a fresh, explicit recipient choice.
    setRecipientId('');
    setError(s.file_share_recipient_unavailable);
  }, [meetingIsCurrent, recipientId, s.file_share_recipient_unavailable, selected]);

  const handleSend = async () => {
    if (!meetingIsCurrent || !payload?.files.length || !recipientIsValid || sendingRef.current) {
      if (!recipientIsValid) setError(s.file_share_recipient_unavailable);
      else if (!meetingIsCurrent) setError(s.file_share_meeting_changed);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError('');
    let saved: SharePayloadV1 | null = null;
    let committed = false;
    try {
      saved = await clonePayloadForApp(payload, 'tencent_meeting');
      const latestMeeting = useMeetingStore.getState().activeMeeting;
      const latestRecipient = recipientId === 'all'
        ? null
        : latestMeeting?.participants.find(participant => participant.id === recipientId);
      if (latestMeeting?.id !== sourceMeetingId || (recipientId !== 'all' && !latestRecipient)) {
        await rollbackPrivateAttachments(saved.files, 'tencent_meeting');
        setError(recipientId !== 'all' && !latestRecipient
          ? s.file_share_recipient_unavailable
          : s.file_share_meeting_changed);
        setSending(false);
        sendingRef.current = false;
        return;
      }
      const sent = sendChatFiles(
        saved.files,
        recipientId,
        recipientId === 'all' ? s.meeting_send_to_all : latestRecipient!.name,
        sourceMeetingId,
      );
      if (!sent) {
        await rollbackPrivateAttachments(saved.files, 'tencent_meeting');
        setError(s.file_share_meeting_changed);
        setSending(false);
        sendingRef.current = false;
        return;
      }
      committed = true;
      go('shareFiles.send', { meetingId: sourceMeetingId, source: 'fileShare' });
    } catch {
      if (!committed && saved?.files.length) {
        await rollbackPrivateAttachments(saved.files, 'tencent_meeting');
      }
      sendingRef.current = false;
      setSending(false);
      setError(s.file_share_copy_failed);
    }
  };

  return (
    <div className="h-full bg-[#f5f6f7] flex flex-col" data-status-bar-foreground="dark">
      <div className="h-10 shrink-0" />
      <div className="h-12 px-3 flex items-center border-b border-gray-100 bg-white shrink-0">
        <button type="button" disabled={sending} className="w-10 h-10 flex items-center justify-center disabled:opacity-40" {...bindBack()}>
          <IcNavBack size={24} className="text-gray-900" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-medium text-gray-900">{s.file_share_title}</h1>
        <div className="w-10" />
      </div>

      {!meetingIsCurrent ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <div>
            <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
              <IcFile size={30} className="text-blue-600" />
            </div>
            <div className="text-[16px] font-medium text-gray-900">{s.file_share_no_meeting_title}</div>
            <div className="mt-2 text-[13px] leading-5 text-gray-500">
              {sourceMeetingId ? s.file_share_meeting_changed : s.file_share_no_meeting_body}
            </div>
          </div>
        </div>
      ) : !payload?.files.length ? (
        <div className="flex-1 flex items-center justify-center text-[14px] text-gray-500">{s.file_share_missing}</div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto" data-scroll-container="main" data-scroll-direction="vertical">
            <div className="px-4 pt-4 pb-2 text-[13px] text-gray-500">{s.file_share_files}</div>
            <div className="mx-4 bg-white rounded-2xl overflow-hidden">
              {payload.files.map((file, index) => (
                <div key={file.fileId} className={`px-4 py-3 flex items-center gap-3 ${index ? 'border-t border-gray-100' : ''}`}>
                  <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-blue-600">{(file.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] text-gray-900">{file.name}</div>
                    <div className="mt-0.5 text-[12px] text-gray-400">{formatSize(file.size)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 pt-5 pb-2 text-[13px] text-gray-500">{s.meeting_send_to}</div>
            <div className="mx-4 bg-white rounded-2xl overflow-hidden">
              <button
                type="button"
                disabled={sending}
                {...bindTap(
                  { kind: 'action', id: 'shareFiles.recipient.select' },
                  { params: { recipientId: 'all' }, onTrigger: () => { setRecipientId('all'); setError(''); } },
                )}
                className="w-full px-4 py-3 flex items-center text-left disabled:opacity-60"
              >
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-[12px]">{s.file_share_all_short}</div>
                <span className="ml-3 flex-1 text-[15px] text-gray-900">{s.meeting_send_to_all}</span>
                {recipientId === 'all' && <IcCheck size={20} className="text-blue-600" />}
              </button>
              {participants.map(participant => (
                <button
                  key={participant.id}
                  type="button"
                  disabled={sending}
                  {...bindTap(
                    { kind: 'action', id: 'shareFiles.recipient.select' },
                    { params: { recipientId: participant.id }, onTrigger: () => { setRecipientId(participant.id); setError(''); } },
                  )}
                  className="w-full px-4 py-3 flex items-center text-left border-t border-gray-100 disabled:opacity-60"
                >
                  <div className="w-9 h-9 rounded-full bg-blue-500 overflow-hidden text-white flex items-center justify-center text-[12px]">
                    {participant.avatar ? <img src={participant.avatar} alt="" className="w-full h-full object-cover" /> : participant.name.slice(0, 2)}
                  </div>
                  <span className="ml-3 flex-1 text-[15px] text-gray-900">{participant.name}</span>
                  {recipientId === participant.id && <IcCheck size={20} className="text-blue-600" />}
                </button>
              ))}
            </div>
            {error && <div className="px-6 mt-4 text-[13px] text-red-500">{error}</div>}
            <div className="h-6" />
          </div>
          <div className="px-4 py-3 bg-white border-t border-gray-100 shrink-0">
            <button
              type="button"
              onClick={() => { void handleSend(); }}
              disabled={sending || !recipientIsValid}
              data-action="shareFiles.send.confirm"
              data-action-type="tap"
              data-action-params={JSON.stringify({ meetingId: sourceMeetingId, recipientId })}
              className="w-full h-12 rounded-xl bg-blue-600 text-white text-[16px] font-medium disabled:opacity-50"
            >
              {sending ? s.file_share_sending : s.file_share_send}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ShareFilesPage;
