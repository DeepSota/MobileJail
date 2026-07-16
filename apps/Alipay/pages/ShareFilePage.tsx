import React, { useMemo, useRef, useState } from 'react';
import { useActivityContext } from '@/os/ActivityContext';
import { useActivityBackBlocker } from '@/os/hooks/useActivityBackBlocker';
import { clonePayloadForApp, parseIntent, rollbackPrivateAttachments } from '@/os/FileShareService';
import type { FileRefV1 } from '@/os/types/fileShare';
import { IcNavBack } from '../res/icons';
import { useAlipayStore } from '../state';
import { useAlipayGestures } from '../hooks/useAlipayGestures';
import { useAlipayStrings } from '../hooks/useAlipayStrings';
import { DefaultAvatar } from '../components/DefaultAvatar';

interface Recipient {
  conversationId: string;
  name: string;
  avatar: string;
}

export const ShareFilePage: React.FC = () => {
  const { activityId } = useActivityContext();
  const contacts = useAlipayStore((state) => state.contacts);
  const conversations = useAlipayStore((state) => state.conversations);
  const sendSharedFiles = useAlipayStore((state) => state.sendSharedFiles);
  const { bindBack, bindTap, go } = useAlipayGestures();
  const s = useAlipayStrings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useActivityBackBlocker('alipay.fileShare', sending);
  const payload = useMemo(() => {
    const intent = window.__OS__?.getIntentPayload?.(activityId)
      ?? window.__OS__?.getIntentPayload?.('alipay');
    return parseIntent(intent);
  }, [activityId]);
  const recipients = useMemo<Recipient[]>(() => {
    const byId = new Map<string, Recipient>();
    for (const conversation of conversations) {
      if (conversation.kind !== 'person') continue;
      byId.set(conversation.id, {
        conversationId: conversation.id,
        name: conversation.name,
        avatar: conversation.avatar ?? '',
      });
    }
    for (const contact of contacts) {
      const conversationId = `conv_p_${contact.id}`;
      if (!byId.has(conversationId)) {
        byId.set(conversationId, {
          conversationId,
          name: contact.name,
          avatar: contact.avatar ?? '',
        });
      }
    }
    return [...byId.values()];
  }, [contacts, conversations]);

  const handleSend = async () => {
    if (!selectedId || !payload?.files.length || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    let copiedFiles: FileRefV1[] = [];
    try {
      const saved = await clonePayloadForApp(payload, 'alipay');
      copiedFiles = saved.files;
      if (!sendSharedFiles(selectedId, saved.files)) {
        await rollbackPrivateAttachments(saved.files, 'alipay');
        sendingRef.current = false;
        setSending(false);
        setError(s.file_share_recipient_unavailable);
        return;
      }
    } catch {
      if (copiedFiles.length > 0) {
        await rollbackPrivateAttachments(copiedFiles, 'alipay');
      }
      sendingRef.current = false;
      setError(s.file_share_error);
      setSending(false);
      return;
    }
    go('share.file.send', { id: selectedId, type: 'person' }, { mode: 'replace' });
  };

  return (
    <div className="h-full min-h-0 bg-app-bg flex flex-col pt-10">
      <header className="h-14 px-4 flex items-center border-b border-app-border bg-app-surface shrink-0">
        <button type="button" {...bindBack()} disabled={sending} className="w-10 h-10 -ml-2 grid place-items-center disabled:opacity-40" aria-label={s.chat}>
          <IcNavBack size={24} />
        </button>
        <div className="ml-2 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 truncate">{s.file_share_title}</h1>
          <p className="text-xs text-gray-500 truncate">{s.file_share_subtitle}</p>
        </div>
      </header>

      {!payload?.files.length ? (
        <div className="flex-1 grid place-items-center px-8 text-center text-gray-500">{s.file_share_missing}</div>
      ) : recipients.length === 0 ? (
        <div className="flex-1 grid place-items-center px-8 text-center text-gray-500">{s.file_share_empty}</div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto bg-app-surface"
          data-scroll-container="main"
          data-scroll-direction="vertical"
        >
          {recipients.map((recipient) => {
            const selected = selectedId === recipient.conversationId;
            return (
              <button
                key={recipient.conversationId}
                type="button"
                disabled={sending}
                {...bindTap(
                  { kind: 'action', id: 'share.file.recipient.select' },
                  { params: { id: recipient.conversationId }, onTrigger: () => setSelectedId(recipient.conversationId) },
                )}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 text-left disabled:opacity-60 ${selected ? 'bg-blue-50' : 'active:bg-gray-50'}`}
              >
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                  {recipient.avatar ? <img src={recipient.avatar} alt="" className="w-full h-full object-cover" /> : <DefaultAvatar iconSize={22} />}
                </div>
                <span className="font-medium text-gray-900 flex-1 truncate">{recipient.name}</span>
                {selected ? <span className="text-xs text-app-primary font-medium">{s.file_share_selected}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <footer className="p-4 bg-app-surface border-t border-app-border shrink-0 sticky bottom-0">
        {error ? <p className="text-sm text-red-500 text-center mb-2">{error}</p> : null}
        <button
          type="button"
          {...bindTap('share.file.send', {
            params: { id: selectedId ?? '', type: 'person' },
            onTrigger: () => { void handleSend(); },
          })}
          disabled={!selectedId || !payload?.files.length || sending}
          className="w-full h-12 rounded-full bg-app-primary text-white font-semibold disabled:opacity-40"
        >
          {sending ? s.file_share_sending : s.file_share_confirm}
        </button>
      </footer>
    </div>
  );
};

export default ShareFilePage;
