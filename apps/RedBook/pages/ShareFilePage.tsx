import React, { useMemo, useRef, useState } from 'react';
import { useActivityContext } from '@/os/ActivityContext';
import { useActivityBackBlocker } from '@/os/hooks/useActivityBackBlocker';
import { clonePayloadForApp, parseIntent, rollbackPrivateAttachments } from '@/os/FileShareService';
import type { FileRefV1 } from '@/os/types/fileShare';
import { IcNavBack } from '../res/icons';
import { useRedBookStore } from '../state';
import { useRedBookBaseDataset } from '../data/view';
import { getRedBookFollowingIds, resolveRedBookRuntimeUser } from '../utils/runtimeResolvers';
import { useRedBookGestures } from '../hooks/useRedBookGestures';
import { useRedBookStrings } from '../hooks/useRedBookStrings';

interface Recipient {
  userId: string;
  username: string;
  avatar: string;
  preview: string;
}

export const ShareFilePage: React.FC = () => {
  const { activityId } = useActivityContext();
  const chats = useRedBookStore((state) => state.chats);
  const user = useRedBookStore((state) => state.user);
  const runtimeUsers = useRedBookStore((state) => state.users);
  const base = useRedBookBaseDataset();
  const sendSharedFiles = useRedBookStore((state) => state.sendSharedFiles);
  const { bindBack, bindTap, go } = useRedBookGestures();
  const s = useRedBookStrings();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useActivityBackBlocker('redbook.fileShare', sending);
  const payload = useMemo(() => {
    const intent = window.__OS__?.getIntentPayload?.(activityId)
      ?? window.__OS__?.getIntentPayload?.('redbook');
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
    for (const userId of getRedBookFollowingIds(user)) {
      if (byId.has(userId)) continue;
      const followedUser = resolveRedBookRuntimeUser(runtimeUsers, base.usersById, user, userId);
      if (!followedUser) continue;
      byId.set(userId, {
        userId,
        username: followedUser.name,
        avatar: followedUser.avatar ?? '',
        preview: s.file_share_following_contact,
      });
    }
    return [...byId.values()];
  }, [base.usersById, chats, runtimeUsers, s.file_share_following_contact, user]);

  const handleSend = async () => {
    if (!selectedUserId || !payload?.files.length || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    let copiedFiles: FileRefV1[] = [];
    try {
      const saved = await clonePayloadForApp(payload, 'redbook');
      copiedFiles = saved.files;
      if (!sendSharedFiles(selectedUserId, saved.files)) {
        await rollbackPrivateAttachments(saved.files, 'redbook');
        sendingRef.current = false;
        setSending(false);
        setError(s.file_share_recipient_unavailable);
        return;
      }
    } catch {
      if (copiedFiles.length > 0) {
        await rollbackPrivateAttachments(copiedFiles, 'redbook');
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
      <header className="h-14 px-3 flex items-center border-b border-gray-100 shrink-0">
        <button type="button" {...bindBack()} disabled={sending} className="w-10 h-10 grid place-items-center disabled:opacity-40" aria-label={s.messages}>
          <IcNavBack size={26} />
        </button>
        <div className="ml-2 min-w-0">
          <h1 className="text-[17px] font-medium text-app-text truncate">{s.file_share_title}</h1>
          <p className="text-[12px] text-app-text-muted truncate">{s.file_share_subtitle}</p>
        </div>
      </header>

      {!payload?.files.length ? (
        <div className="flex-1 grid place-items-center px-8 text-center text-app-text-muted">{s.file_share_missing}</div>
      ) : recipients.length === 0 ? (
        <div className="flex-1 grid place-items-center px-8 text-center text-app-text-muted">{s.file_share_empty}</div>
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
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left disabled:opacity-60 ${selected ? 'bg-red-50' : 'active:bg-gray-50'}`}
              >
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 shrink-0">
                  {recipient.avatar ? <img src={recipient.avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center bg-app-primary text-white font-medium">{recipient.username[0]}</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-app-text truncate">{recipient.username}</div>
                  <div className="text-[12px] text-app-text-muted truncate">{recipient.preview}</div>
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
