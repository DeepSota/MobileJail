import React, { useMemo, useRef, useState } from 'react';
import { useActivityContext } from '@/os/ActivityContext';
import { useActivityBackBlocker } from '@/os/hooks/useActivityBackBlocker';
import { clonePayloadForApp, parseIntent, rollbackPrivateAttachments } from '@/os/FileShareService';
import { IcNavBack } from '../res/icons';
import { useXAllUsers, useXConversations } from '../data/view';
import { useXStore } from '../state';
import { useXGestures } from '../hooks/useXGestures';
import { useXStrings } from '../hooks/useXStrings';

interface ShareRecipient {
  id: string;
  participantId: string;
  expectedConversationId?: string;
  participant: { id: string; name: string; avatar?: string; verified?: boolean };
}

export const ShareFilePage: React.FC = () => {
  const { activityId } = useActivityContext();
  const conversations = useXConversations();
  const allUsers = useXAllUsers();
  const followedUserIds = useXStore((state) => state.user.followedUserIds);
  const sendSharedFilesToRecipient = useXStore((state) => state.sendSharedFilesToRecipient);
  const { bindBack, bindTap, go } = useXGestures();
  const s = useXStrings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useActivityBackBlocker('x.fileShare', sending);
  const payload = useMemo(() => {
    const intent = window.__OS__?.getIntentPayload?.(activityId)
      ?? window.__OS__?.getIntentPayload?.('x');
    return parseIntent(intent);
  }, [activityId]);
  const recipients = useMemo<ShareRecipient[]>(() => {
    const result: ShareRecipient[] = conversations.map((conversation) => ({
      id: `conversation:${conversation.id}`,
      participantId: conversation.participant.id,
      expectedConversationId: conversation.id,
      participant: conversation.participant,
    }));
    const existingParticipantIds = new Set(result.map((item) => item.participantId));
    for (const userId of followedUserIds) {
      if (existingParticipantIds.has(userId)) continue;
      const user = allUsers[userId];
      if (!user) continue;
      result.push({
        id: `user:${user.id}`,
        participantId: user.id,
        participant: user,
      });
    }
    return result;
  }, [allUsers, conversations, followedUserIds]);

  const handleSend = async () => {
    if (!selectedId || !payload?.files.length || sendingRef.current) return;
    const recipient = recipients.find((item) => item.id === selectedId);
    if (!recipient) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    let savedPayload: Awaited<ReturnType<typeof clonePayloadForApp>>;
    try {
      savedPayload = await clonePayloadForApp(payload, 'x');
    } catch {
      sendingRef.current = false;
      setError(s.share_file_error);
      setSending(false);
      return;
    }

    let sent = false;
    let deliveryFailed = false;
    let conversationId: string | null = null;
    try {
      conversationId = sendSharedFilesToRecipient({
        participantId: recipient.participantId,
        expectedConversationId: recipient.expectedConversationId,
        files: savedPayload.files,
      });
      sent = Boolean(conversationId);
    } catch {
      deliveryFailed = true;
    }
    if (!sent) {
      await rollbackPrivateAttachments(savedPayload.files, 'x');
      sendingRef.current = false;
      setSending(false);
      setError(deliveryFailed ? s.share_file_error : s.share_file_recipient_unavailable);
      return;
    }
    if (conversationId) go('share.file.send', { id: conversationId }, { mode: 'replace' });
  };

  return (
    <div className="h-full flex flex-col bg-app-bg text-app-text pt-10">
      <header className="h-14 px-4 flex items-center border-b border-app-border shrink-0">
        <button type="button" {...bindBack()} disabled={sending} className="w-10 h-10 -ml-2 flex items-center justify-center disabled:opacity-40" aria-label={s.chat_back}>
          <IcNavBack size={20} />
        </button>
        <div className="ml-2 min-w-0">
          <h1 className="font-bold text-lg truncate">{s.share_file_title}</h1>
          <p className="text-xs text-gray-500 truncate">{s.share_file_subtitle}</p>
        </div>
      </header>

      {!payload?.files.length ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center text-gray-500">{s.share_file_missing}</div>
      ) : recipients.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center text-gray-500">{s.share_file_empty}</div>
      ) : (
        <div className="flex-1 overflow-y-auto" data-scroll-container="main" data-scroll-direction="vertical">
          {recipients.map((recipient) => {
            const selected = selectedId === recipient.id;
            return (
              <button
                key={recipient.id}
                type="button"
                disabled={sending}
                {...bindTap(
                  { kind: 'action', id: 'share.file.recipient.select' },
                  { params: { id: recipient.id }, onTrigger: () => setSelectedId(recipient.id) },
                )}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-app-border disabled:opacity-60 ${selected ? 'bg-blue-50' : 'active:bg-gray-50'}`}
              >
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 shrink-0">
                  {recipient.participant.avatar ? (
                    <img src={recipient.participant.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center bg-blue-500 text-white font-bold">{recipient.participant.name[0]}</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{recipient.participant.name}</div>
                  <div className="text-sm text-gray-500 truncate">@{recipient.participant.id}</div>
                </div>
                {selected ? <span className="text-xs font-semibold text-blue-500">{s.share_file_selected}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <footer className="p-4 border-t border-app-border shrink-0 bg-app-bg">
        {error ? <p className="text-sm text-red-500 mb-2 text-center">{error}</p> : null}
        <button
          type="button"
          {...bindTap('share.file.send', {
            params: { id: selectedId ?? '' },
            onTrigger: () => { void handleSend(); },
          })}
          disabled={!selectedId || !payload?.files.length || sending}
          className="w-full h-12 rounded-full bg-blue-500 text-white font-bold disabled:opacity-40"
        >
          {sending ? s.share_file_sending : s.share_file_confirm}
        </button>
      </footer>
    </div>
  );
};

export default ShareFilePage;
