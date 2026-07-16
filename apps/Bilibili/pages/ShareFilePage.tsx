import React, { useMemo, useRef, useState } from 'react';
import { useActivityContext } from '@/os/ActivityContext';
import { useActivityBackBlocker } from '@/os/hooks/useActivityBackBlocker';
import { clonePayloadForApp, parseIntent, rollbackPrivateAttachments } from '@/os/FileShareService';
import type { FileRefV1 } from '@/os/types/fileShare';
import { IcNavBack } from '../res/icons';
import { useBilibiliStore } from '../state';
import { useBilibiliGestures } from '../hooks/useBilibiliGestures';
import { useBilibiliStrings } from '../hooks/useBilibiliStrings';

interface Recipient {
  userId: string;
  username: string;
  avatar: string;
  preview: string;
}

export const ShareFilePage: React.FC = () => {
  const { activityId } = useActivityContext();
  const chats = useBilibiliStore((state) => state.chats);
  const user = useBilibiliStore((state) => state.user);
  const sendSharedFiles = useBilibiliStore((state) => state.sendSharedFiles);
  const { bindBack, bindTap, go } = useBilibiliGestures();
  const s = useBilibiliStrings();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useActivityBackBlocker('bilibili.fileShare', sending);
  const payload = useMemo(() => {
    const intent = window.__OS__?.getIntentPayload?.(activityId)
      ?? window.__OS__?.getIntentPayload?.('bilibili');
    return parseIntent(intent);
  }, [activityId]);
  const recipients = useMemo<Recipient[]>(() => {
    const byId = new Map<string, Recipient>();
    for (const chat of chats) {
      byId.set(chat.userId, {
        userId: chat.userId,
        username: chat.username,
        avatar: chat.avatar,
        preview: chat.lastMessage ?? '',
      });
    }
    for (const relation of [...(user.followingList ?? []), ...(user.followersList ?? [])]) {
      const userId = String(relation.mid);
      if (!byId.has(userId)) {
        byId.set(userId, {
          userId,
          username: relation.name,
          avatar: relation.face,
          preview: '',
        });
      }
    }
    return [...byId.values()];
  }, [chats, user.followersList, user.followingList]);

  const handleSend = async () => {
    if (!selectedUserId || !payload?.files.length || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    let copiedFiles: FileRefV1[] = [];
    try {
      const saved = await clonePayloadForApp(payload, 'bilibili');
      copiedFiles = saved.files;
      if (!sendSharedFiles(selectedUserId, saved.files)) {
        await rollbackPrivateAttachments(saved.files, 'bilibili');
        sendingRef.current = false;
        setSending(false);
        setError(s.file_share_recipient_unavailable);
        return;
      }
    } catch {
      if (copiedFiles.length > 0) {
        await rollbackPrivateAttachments(copiedFiles, 'bilibili');
      }
      sendingRef.current = false;
      setError(s.file_share_error);
      setSending(false);
      return;
    }
    go('share.file.send', { userId: selectedUserId }, { mode: 'replace' });
  };

  return (
    <div className="h-full flex flex-col bg-app-surface pt-10">
      <header className="h-14 px-4 flex items-center border-b border-gray-100 shrink-0">
        <button type="button" {...bindBack()} disabled={sending} className="w-9 h-9 flex items-center justify-start disabled:opacity-40" aria-label={s.file_share_title}>
          <IcNavBack size={24} />
        </button>
        <div className="ml-1 min-w-0">
          <h1 className="text-[17px] font-medium text-app-text truncate">{s.file_share_title}</h1>
          <p className="text-[12px] text-gray-400 truncate">{s.file_share_subtitle}</p>
        </div>
      </header>

      {!payload?.files.length ? (
        <div className="flex-1 grid place-items-center px-8 text-center text-gray-400">{s.file_share_missing}</div>
      ) : recipients.length === 0 ? (
        <div className="flex-1 grid place-items-center px-8 text-center text-gray-400">{s.file_share_empty}</div>
      ) : (
        <div className="flex-1 overflow-y-auto" data-scroll-container="main" data-scroll-direction="vertical">
          {recipients.map((recipient) => {
            const selected = selectedUserId === recipient.userId;
            return (
              <button
                key={recipient.userId}
                type="button"
                disabled={sending}
                {...bindTap(
                  { kind: 'action', id: 'share.file.recipient.select' },
                  { params: { userId: recipient.userId }, onTrigger: () => setSelectedUserId(recipient.userId) },
                )}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left disabled:opacity-60 ${selected ? 'bg-pink-50' : 'active:bg-gray-50'}`}
              >
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 shrink-0">
                  {recipient.avatar ? <img src={recipient.avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center bg-app-primary text-white font-medium">{recipient.username[0]}</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-app-text truncate">{recipient.username}</div>
                  {recipient.preview ? <div className="text-[12px] text-gray-400 truncate">{recipient.preview}</div> : null}
                </div>
                {selected ? <span className="text-[12px] text-app-primary font-medium">{s.file_share_selected}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <footer className="p-4 border-t border-gray-100 bg-app-surface shrink-0">
        {error ? <p className="text-sm text-red-500 text-center mb-2">{error}</p> : null}
        <button
          type="button"
          {...bindTap('share.file.send', {
            params: { userId: selectedUserId ?? '' },
            onTrigger: () => { void handleSend(); },
          })}
          disabled={!selectedUserId || !payload?.files.length || sending}
          className="w-full h-12 rounded-full bg-app-primary text-white font-medium disabled:opacity-40"
        >
          {sending ? s.file_share_sending : s.file_share_confirm}
        </button>
      </footer>
    </div>
  );
};

export default ShareFilePage;
