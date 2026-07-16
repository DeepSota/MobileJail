import { useAlipayStrings } from '../hooks/useAlipayStrings';
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { IcNavBack, IcMoreHorizontal, IcMic, IcAdd, IcSmile, IcTransfer, IcImage } from '../res/icons';
import { useAlipayStore } from '../state';
import { useAlipayGestures } from '../hooks/useAlipayGestures';
import * as TimeService from '../../../os/TimeService';
import * as MediaService from '../../../os/MediaService';
import { useLocale } from '@/apps/Alipay/locale';
import { DefaultAvatar } from '../components/DefaultAvatar';
import type { ChatMessage } from '../types';
import { SharedFileImage } from '@/os/components/SharedFileImage';
import { createViewIntent, openFileRefInViewer } from '@/os/FileShareService';

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatMsgTime(ts: number, isEnglish: boolean): string {
  const d = TimeService.fromTimestamp(ts);
  const now = TimeService.getDate();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return hm;
  const yesterday = TimeService.fromLocalParts(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear()
    && d.getMonth() === yesterday.getMonth()
    && d.getDate() === yesterday.getDate();
  if (isYesterday) return isEnglish ? `Yesterday ${hm}` : `昨天 ${hm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) return isEnglish ? `${d.getMonth() + 1}/${d.getDate()} ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return isEnglish ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** Transfer message bubble */
const TransferBubble: React.FC<{ msg: ChatMessage; isMe: boolean }> = ({ msg, isMe }) => {
  const s = useAlipayStrings();
  const isEnglish = useLocale() === 'en';
  const label = isEnglish ? 'Transfer' : '转账';
  const amount = msg.content;

  return (
    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
      <div className={`px-4 py-3 rounded-xl ${isMe ? 'rounded-tr-none bg-app-primary' : 'rounded-tl-none bg-white border border-gray-100'} shadow-sm`}>
        <div className={`text-[12px] ${isMe ? 'text-white/70' : 'text-gray-500'} mb-1`}>{label}</div>
        <div className={`text-[22px] font-bold ${isMe ? 'text-white' : 'text-gray-900'}`}>{amount}</div>
        <div className={`text-[11px] mt-1 ${isMe ? 'text-white/60' : 'text-gray-400'}`}>
          {isEnglish ? 'Alipay Transfer' : '支付宝转账'}
        </div>
      </div>
    </div>
  );
};

/** Image message bubble */
const ImageBubble: React.FC<{
  msg: ChatMessage;
  isMe: boolean;
  onUnavailable: () => void;
}> = ({ msg, isMe, onUnavailable }) => {
  const [preview, setPreview] = React.useState(false);
  const s = useAlipayStrings();
  const { bindTap } = useAlipayGestures();
  const openSharedFile = () => {
    if (!msg.fileRef) return;
    const intent = createViewIntent(msg.fileRef);
    const opened = intent ? window.__OS__?.startActivity('gallery', intent) : false;
    if (!opened) onUnavailable();
  };

  return (
    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        className={`max-w-[70%] rounded-xl overflow-hidden ${isMe ? 'rounded-tr-none' : 'rounded-tl-none'}`}
        {...(msg.fileRef ? bindTap(
          { kind: 'action', id: 'chat.file.open' },
          { params: { fileId: msg.fileRef.fileId }, onTrigger: openSharedFile },
        ) : { onClick: () => setPreview(true) })}
        aria-label={msg.fileRef ? s.file_attachment_open : undefined}
      >
        {msg.fileRef ? (
          <span className="relative block min-w-24 min-h-20 bg-gray-100">
            <span className="absolute inset-0 grid place-items-center px-2 text-center text-[12px] text-gray-500">
              {s.file_attachment_unavailable}
            </span>
            <SharedFileImage fileRef={msg.fileRef} alt={msg.fileRef.name} className="relative z-10 max-h-[200px] w-auto object-cover" draggable={false} />
          </span>
        ) : (
          <img src={msg.content} alt="" className="max-h-[200px] w-auto object-cover" draggable={false} />
        )}
      </button>
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setPreview(false)}
        >
          <img src={msg.content} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
        </div>
      )}
    </div>
  );
};

const FileBubble: React.FC<{
  msg: ChatMessage;
  isMe: boolean;
  onUnavailable: () => void;
}> = ({ msg, isMe, onUnavailable }) => {
  const s = useAlipayStrings();
  const { bindTap } = useAlipayGestures();
  if (!msg.fileRef) return null;
  const fileRef = msg.fileRef;
  const openFile = () => {
    if (!openFileRefInViewer(fileRef)) onUnavailable();
  };
  return (
    <button
      type="button"
      {...bindTap(
        { kind: 'action', id: 'chat.file.open' },
        { params: { fileId: fileRef.fileId }, onTrigger: openFile },
      )}
      className={`max-w-[17rem] min-w-[14rem] px-3 py-3 rounded-xl flex items-center gap-3 text-left shadow-sm ${isMe ? 'rounded-tr-none bg-app-primary text-white' : 'rounded-tl-none bg-app-surface text-gray-900'}`}
      aria-label={`${s.file_attachment_open}: ${fileRef.name}`}
    >
      <span className={`w-11 h-12 rounded-lg grid place-items-center text-[11px] font-bold uppercase shrink-0 ${isMe ? 'bg-white/20' : 'bg-blue-50 text-app-primary'}`}>
        {fileRef.name.split('.').pop()?.slice(0, 4) || 'FILE'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{fileRef.name}</span>
        <span className={`block text-[11px] mt-1 ${isMe ? 'text-white/70' : 'text-gray-400'}`}>{formatFileSize(fileRef.size)}</span>
      </span>
    </button>
  );
};

export const ChatPage: React.FC = () => {
  const s = useAlipayStrings();
  const locale = useLocale();
  const isEnglish = locale === 'en';
  const [searchParams] = useSearchParams();
  const convId = searchParams.get('id') ?? '';
  const conversations = useAlipayStore(st => st.conversations);
  const chatHistory = useAlipayStore(st => st.chatHistory);
  const contacts = useAlipayStore(st => st.contacts);
  const sendChatMessage = useAlipayStore(st => st.sendChatMessage);
  const sendImages = useAlipayStore(st => st.sendImages);
  const markConversationRead = useAlipayStore(st => st.markConversationRead);
  const { bindBack, bindTap } = useAlipayGestures();

  const conv = conversations.find(c => c.id === convId);
  const fallbackContactId = conv?.kind === 'person'
    ? conv.contactId
    : convId.startsWith('conv_p_')
      ? convId.slice('conv_p_'.length)
      : null;
  const contactData = fallbackContactId
    ? contacts.find(c => String(c.id) === fallbackContactId) ?? null
    : null;

  React.useEffect(() => {
    if (convId) markConversationRead(convId);
  }, [convId, markConversationRead]);
  const title = conv?.name || contactData?.name || s.chat;
  const peerAvatar = conv?.avatar || contactData?.avatar || '';
  const history = React.useMemo(() => {
    const existing = chatHistory[convId] || [];
    if (existing.length > 0) return existing;
    if (!conv?.lastContent) return [];
    return [{
      id: `fallback-${convId}`,
      senderId: conv.kind === 'person' ? conv.contactId : 'system',
      type: 'text' as const,
      content: conv.lastContent,
      timestamp: conv.lastTimestamp,
    }];
  }, [chatHistory, conv, convId]);

  const [inputText, setInputText] = React.useState('');
  const [attachmentToast, setAttachmentToast] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [history.length]);

  const handleSend = () => {
    if (!inputText.trim() || !convId) return;
    sendChatMessage(convId, inputText.trim());
    setInputText('');
  };

  const handleSelectImage = async () => {
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: true, maxSelect: 9 });
      if (result.cancelled || !result.selected.length || !convId) return;
      const uris = result.selected.map(item => item.uri || item.path).filter(Boolean);
      if (uris.length) sendImages(convId, uris);
    } catch {
      // picker dismissed
    }
  };

  const showAttachmentUnavailable = React.useCallback(() => {
    setAttachmentToast(s.file_attachment_unavailable);
    window.setTimeout(() => {
      setAttachmentToast(current => current === s.file_attachment_unavailable ? '' : current);
    }, 2500);
  }, [s.file_attachment_unavailable]);

  const targetContactId = contactData?.id
    ? String(contactData.id)
    : conv?.kind === 'person'
      ? conv.contactId
      : null;

  const renderMessage = (msg: ChatMessage, isMe: boolean) => {
    if (msg.type === 'transfer') {
      return <TransferBubble msg={msg} isMe={isMe} />;
    }
    if (msg.type === 'image') {
      return <ImageBubble msg={msg} isMe={isMe} onUnavailable={showAttachmentUnavailable} />;
    }
    if (msg.type === 'file') {
      return <FileBubble msg={msg} isMe={isMe} onUnavailable={showAttachmentUnavailable} />;
    }
    // Default text bubble
    return (
      <div className={`px-3 py-3 rounded-xl max-w-[70%] shadow-sm ${
        isMe
          ? 'rounded-tr-none bg-app-primary text-white'
          : 'rounded-tl-none bg-app-surface text-gray-900'
      }`}>
        <div className="text-base">{msg.content}</div>
      </div>
    );
  };

  return (
    <div className="relative bg-app-bg h-full flex flex-col">
      {/* Header */}
      <div className="bg-app-bg px-4 pt-12 pb-3 border-b border-app-border sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <button {...bindBack<HTMLButtonElement>()} className="mr-2">
              <IcNavBack size={24} className="text-gray-900" />
            </button>
            <span className="text-lg font-medium text-gray-900">{title}</span>
          </div>
          <button>
            <IcMoreHorizontal size={24} className="text-gray-900" />
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto">
        {history.map((msg, idx) => {
          const isMe = msg.senderId === 'self';
          const showTime = idx === 0
            || msg.timestamp - history[idx - 1].timestamp > 5 * 60 * 1000;
          return (
            <React.Fragment key={msg.id}>
              {showTime && (
                <div className="text-center text-xs text-gray-400 mb-4">
                  {formatMsgTime(msg.timestamp, isEnglish)}
                </div>
              )}
              {isMe ? (
                <div className="flex items-start justify-end mb-4">
                  <div className="mr-3">
                    {renderMessage(msg, true)}
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-gray-200 overflow-hidden flex-shrink-0">
                    <DefaultAvatar iconSize={20} />
                  </div>
                </div>
              ) : (
                <div className="flex items-start mb-4">
                  <button
                    className="w-10 h-10 rounded-lg bg-gray-200 overflow-hidden mr-3 flex-shrink-0"
                    {...(targetContactId ? bindTap<HTMLButtonElement>('contacts.profile.open', { params: { contactId: targetContactId } }) : {})}
                  >
                    {peerAvatar ? (
                      <img src={peerAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <DefaultAvatar iconSize={20} />
                    )}
                  </button>
                  <div>
                    {renderMessage(msg, false)}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="bg-app-surface px-3 py-2 border-t border-app-border flex items-center gap-2 pb-safe" data-keep-keyboard="true">
        <button onClick={handleSelectImage} className="p-1">
          <IcImage size={22} className="text-gray-600" />
        </button>
        <div className="flex-1 bg-gray-100 rounded-lg px-3 py-2">
          <input
            type="text"
            className="w-full bg-transparent outline-none text-base"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={s.chatpage_input_placeholder}
          />
        </div>
        <IcSmile size={24} className="text-gray-600" />
        {inputText.trim() ? (
          <button onClick={handleSend} className="bg-app-primary text-white px-3 py-1 rounded text-sm">
            {s.chatpage_send}
          </button>
        ) : targetContactId ? (
          <button {...bindTap('transfer.amount.open', { params: { contactId: targetContactId, fromChat: '1' } })}>
            <IcTransfer size={24} className="text-gray-600" />
          </button>
        ) : (
          <IcAdd size={24} className="text-gray-600" />
        )}
      </div>
      {attachmentToast && (
        <div role="status" className="absolute left-1/2 bottom-20 z-50 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-[13px] text-white shadow-lg">
          {attachmentToast}
        </div>
      )}
    </div>
  );
};
