import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IcNavBack, IcExpand } from '../res/icons';
import { AttachmentPanel } from './AttachmentPanel';
import { Toast } from '@/os/components/Toast';
import { markConversationRead, sendImage, sendMessage, sendFile, useSmsProviderState } from '../state';
import { useTheme } from '../../../os/ThemeContext';
import { NinePatch } from '../../../os/ui/ninepatch/NinePatch';
import { SendArrowIcon } from '../res/icons';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSmsGestures } from '../hooks/useSmsGestures';
import * as MediaService from '../../../os/MediaService';
import type { Message } from '../types';

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** File icon SVG */
const FileIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const ImageBubble: React.FC<{
  outgoing: boolean;
  src: string;
  timestamp: string;
  status?: string;
}> = ({ outgoing, src, timestamp, status }) => {
  const s = useAppStrings(strings, stringsEn);
  const [preview, setPreview] = useState(false);

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        className={`max-w-[78%] rounded-2xl overflow-hidden ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} active:opacity-90`}
        onClick={() => setPreview(true)}
      >
        <img
          src={src}
          alt=""
          className="max-h-[200px] w-auto object-cover"
          draggable={false}
        />
      </button>
      <div className="mt-1 text-[11px] text-gray-400 flex items-center gap-2">
        <span>{timestamp}</span>
        {outgoing && status && <span>{status === 'sending' ? s.status_sending : s.status_sent}</span>}
      </div>

      {/* Fullscreen preview overlay */}
      {preview ? (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setPreview(false)}
        >
          <img src={src} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
        </div>
      ) : null}
    </div>
  );
};

const FileBubble: React.FC<{
  outgoing: boolean;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  timestamp: string;
  status?: string;
}> = ({ outgoing, fileName, fileSize, timestamp, status }) => {
  const s = useAppStrings(strings, stringsEn);
  const borderColor = outgoing ? 'border-app-primary/30' : 'border-gray-100';

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[78%] px-3 py-2.5 rounded-2xl ${outgoing ? 'rounded-tr-md bg-app-primary/10' : 'rounded-tl-md bg-app-surface'} border ${borderColor} flex items-center gap-3`}>
        <FileIcon size={28} className={outgoing ? 'text-app-primary' : 'text-gray-500'} />
        <div className="min-w-0 flex-1">
          <div className={`text-[14px] font-medium truncate ${outgoing ? 'text-app-text' : 'text-app-text'}`}>{fileName}</div>
          {fileSize != null ? (
            <div className="text-[11px] text-gray-400">{formatFileSize(fileSize)}</div>
          ) : null}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-gray-400 flex items-center gap-2">
        <span>{timestamp}</span>
        {outgoing && status && <span>{status === 'sending' ? s.status_sending : s.status_sent}</span>}
      </div>
    </div>
  );
};

const TextBubble: React.FC<{
    outgoing: boolean;
    content: string;
    timestamp: string;
    status?: string;
}> = ({ outgoing, content, timestamp, status }) => {
    const { themeService, version } = useTheme();
    const s = useAppStrings(strings, stringsEn);
    const bubbleCls = outgoing
        ? 'bg-app-primary text-white rounded-2xl rounded-tr-md'
        : 'bg-app-surface text-app-text rounded-2xl rounded-tl-md border border-gray-100';

    const themedBg = useMemo(() => {
        const pick = (hints: string[]) => hints.map((h) => themeService.getAppAsset('mms', h)).find(Boolean) || null;
        return outgoing
            ? pick(['bubble_out', 'bubble_send', 'msg_out', 'message_out', 'chat_to', 'sms_out'])
            : pick(['bubble_in', 'bubble_recv', 'msg_in', 'message_in', 'chat_from', 'sms_in']);
    }, [outgoing, themeService, version]);

    return (
        <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
            {themedBg ? (
                <NinePatch
                    src={themedBg}
                    className={`max-w-[78%] text-[15px] leading-relaxed ${bubbleCls.replace(outgoing ? 'bg-app-primary' : 'bg-app-surface', 'bg-transparent')}`}
                >
                    <div className="px-4 py-2.5">{content}</div>
                </NinePatch>
            ) : (
                <div className={`max-w-[78%] px-4 py-2.5 text-[15px] leading-relaxed ${bubbleCls}`}>{content}</div>
            )}
            <div className="mt-1 text-[11px] text-gray-400 flex items-center gap-2">
                <span>{timestamp}</span>
                {outgoing && status && <span>{status === 'sending' ? s.status_sending : s.status_sent}</span>}
            </div>
        </div>
    );
};

const MessageBubble: React.FC<{
  message: Message;
}> = ({ message }) => {
  const msgType = message.type || 'text';
  if (msgType === 'image') {
    return (
      <ImageBubble
        outgoing={message.isOutgoing}
        src={message.content}
        timestamp={message.timestamp}
        status={message.status}
      />
    );
  }
  if (msgType === 'file') {
    return (
      <FileBubble
        outgoing={message.isOutgoing}
        fileName={message.fileName || 'file'}
        fileSize={message.fileSize}
        mimeType={message.mimeType}
        timestamp={message.timestamp}
        status={message.status}
      />
    );
  }
  return (
    <TextBubble
      outgoing={message.isOutgoing}
      content={message.content}
      timestamp={message.timestamp}
      status={message.status}
    />
  );
};

export const ConversationDetailPage: React.FC = () => {
    const { bindBack, go } = useSmsGestures();
    const { conversationId } = useParams<{ conversationId: string }>();
    const { conversations, messagesByConversationId } = useSmsProviderState();
    const conversation = useMemo(
        () => conversationId ? conversations.find(c => c.id === conversationId) : undefined,
        [conversations, conversationId],
    );
    const messages = useMemo(
        () => conversationId ? (messagesByConversationId[conversationId] ?? []) : [],
        [messagesByConversationId, conversationId],
    );
    const s = useAppStrings(strings, stringsEn);

    const [text, setText] = useState('');
    const [showAttachments, setShowAttachments] = useState(false);
    const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!conversationId) return;
        markConversationRead(conversationId);
    }, [conversationId, markConversationRead]);

    useEffect(() => {
        // Scroll to bottom on first open & when new message arrives
        const el = listRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const showToast = (message: string) => {
        setToast({ visible: true, message });
        window.setTimeout(() => setToast({ visible: false, message: '' }), 1200);
    };

    const canSend = text.trim().length > 0 && !!conversationId && !!conversation;
    const handleSend = () => {
        if (!canSend || !conversationId || !conversation) return;
        const content = text.trim();
        setText('');
        setShowAttachments(false);
        sendMessage(conversationId, content);
    };

    // Image picker via OS MediaService
    const handleSelectImage = async () => {
      setShowAttachments(false);
      try {
        const result = await MediaService.pickMedia({ type: 'image', multiple: true, maxSelect: 9 });
        if (result.cancelled || !result.selected.length || !conversationId) return;
        for (const item of result.selected) {
          sendImage(conversationId, item.uri || item.path);
        }
      } catch {
        // picker dismissed or not available
      }
    };

    // File picker via in-app route
    const handleSelectFile = () => {
      setShowAttachments(false);
      if (!conversationId) return;
      go('conversation.selectFile', { conversationId });
    };

    if (!conversationId || !conversation) {
        return (
            <div className="h-full bg-app-surface flex flex-col">
                <div className="h-12 flex-shrink-0" />
                <div className="flex items-center px-4 h-12">
                    <button className="w-10 h-10 -ml-2 flex items-center justify-center" {...bindBack()}>
                        <IcNavBack size={24} className="text-app-text" />
                    </button>
                </div>
                <div className="px-6 pt-2 pb-4">
                    <h1 className="text-[18px] font-medium text-app-text">{s.conversation_not_found}</h1>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full bg-app-bg flex flex-col">
            <Toast message={toast.message} visible={toast.visible} />

            {/* Status bar spacer */}
            <div className="h-12 flex-shrink-0" />

            {/* Header */}
            <div className="flex items-center px-4 h-12 flex-shrink-0">
                <button className="w-10 h-10 -ml-2 flex items-center justify-center" {...bindBack()}>
                    <IcNavBack size={24} className="text-app-text" />
                </button>
                <div className="flex-1 text-center">
                    <div className="text-[16px] font-medium text-app-text truncate">{conversation?.sender ?? s.app_name}</div>
                </div>
                <div className="w-10 h-10 -mr-2" />
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 flex flex-col gap-3">
                {messages.length === 0 ? (
                    <div className="text-center text-[13px] text-gray-400 mt-10">{s.empty_messages}</div>
                ) : (
                    messages.map((m) => (
                        <MessageBubble key={m.id} message={m} />
                    ))
                )}
                <div className="h-2" />
            </div>

            {/* Bottom input area */}
            <div className="flex-shrink-0 border-t border-gray-100 bg-app-bg" data-keep-keyboard="true">
                {showAttachments && (
                  <AttachmentPanel
                    onSelectImage={handleSelectImage}
                    onSelectFile={handleSelectFile}
                  />
                )}

                <div className="flex items-center px-3 py-2 gap-2">
                    <button
                        className="w-11 h-11 flex items-center justify-center bg-app-surface rounded-lg"
                        onClick={() => setShowAttachments((v) => !v)}
                    >
                        {showAttachments ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        )}
                    </button>

                    <div className="flex-1 bg-app-surface rounded-full flex items-center px-4 py-2.5">
                        <input
                            type="text"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSend();
                            }}
                            className="flex-1 text-[14px] text-app-text outline-none"
                            placeholder={s.sms_placeholder}
                        />
                    </div>

                    <button
                        className={`w-11 h-11 flex items-center justify-center rounded-full ${canSend ? 'bg-app-primary' : 'bg-gray-200'
                            }`}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={handleSend}
                        aria-disabled={!canSend}
                    >
                        <SendArrowIcon active={canSend} />
                    </button>
                </div>
            </div>
        </div>
    );
};