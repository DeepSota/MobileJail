import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IcNavBack } from '../res/icons';
import { ImageIcon } from 'lucide-react';
import { AttachmentPanel } from './AttachmentPanel';
import { markConversationRead, sendMessage, sendSharedAttachments, useSmsProviderState } from '../state';
import { useTheme } from '../../../os/ThemeContext';
import { NinePatch } from '../../../os/ui/ninepatch/NinePatch';
import { SendArrowIcon } from '../res/icons';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSmsGestures } from '../hooks/useSmsGestures';
import * as MediaService from '../../../os/MediaService';
import type { Message } from '../types';
import type { FileRefV1 } from '../../../os/types/fileShare';
import { SharedFileImage } from '../../../os/components/SharedFileImage';
import { clonePayloadForApp, createPayload as createFileSharePayload, createViewIntent, openFileRefInViewer } from '../../../os/FileShareService';
import { Toast } from '../../../os/components/Toast';

function formatFileSize(
  bytes: number,
  units: { mb: string; kb: string; bytes: string },
): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${units.mb}`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} ${units.kb}`;
  return `${bytes} ${units.bytes}`;
}

/** File icon SVG */
const FileIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const ImageBubble: React.FC<{
  messageId: string;
  outgoing: boolean;
  src: string;
  fileRef?: FileRefV1;
  timestamp: string;
  status?: string;
  onOpenError: () => void;
}> = ({ messageId, outgoing, src, fileRef, timestamp, status, onOpenError }) => {
  const s = useAppStrings(strings, stringsEn);
  const [preview, setPreview] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Track whether an objectUrl has resolved so we don't treat the transient
  // fallbackSrc failure as permanent.  When fileRef is present, the async
  // SharedFileImage will eventually produce a blob URL; the temporary
  // fallbackSrc (content://simfs/…) is not browser-loadable but that's
  // expected — we must not lock into the error state before the real URL
  // arrives.
  const [resolved, setResolved] = useState(false);
  const imageContent = fileRef ? (
    <SharedFileImage
      fileRef={fileRef}
      fallbackSrc={src}
      alt=""
      className="max-h-[200px] w-auto object-cover"
      draggable={false}
      onLoad={() => { setLoadError(false); setResolved(true); }}
      onError={() => { if (resolved) setLoadError(true); }}
    />
  ) : (
    <img
      src={src}
      alt=""
      className="max-h-[200px] w-auto object-cover"
      draggable={false}
      onError={() => setLoadError(true)}
    />
  );
  // When the image fails to load (e.g. blob not yet in IndexedDB), show a
  // visible placeholder so the bubble doesn't collapse to 0 height and the
  // attachment remains discoverable.
  const fallbackContent = loadError ? (
    <div className="w-[180px] h-[120px] bg-gray-100 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400">
      <ImageIcon size={28} />
      <span className="text-[11px] truncate max-w-[140px]">{s.attachment_image}</span>
    </div>
  ) : null;
  const buttonClassName = `max-w-[78%] rounded-2xl overflow-hidden ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} active:opacity-90`;

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
      {fileRef ? (
        <button
          type="button"
          data-action="sms.attachment.open"
          data-action-type="tap"
          data-action-params={JSON.stringify({ messageId, fileId: fileRef.fileId })}
          className={buttonClassName}
          onClick={() => {
            if (loadError) { onOpenError(); return; }
            const intent = createViewIntent(fileRef, { targetAppId: 'gallery' });
            if (!intent || !window.__OS__?.startActivity('gallery', intent)) onOpenError();
          }}
        >
          {fallbackContent || imageContent}
        </button>
      ) : (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => { if (!loadError) setPreview(true); }}
        >
          {fallbackContent || imageContent}
        </button>
      )}
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
  messageId: string;
  outgoing: boolean;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  timestamp: string;
  status?: string;
  fileRef?: FileRefV1;
  onOpenError: () => void;
}> = ({ messageId, outgoing, fileName, fileSize, timestamp, status, fileRef, onOpenError }) => {
  const s = useAppStrings(strings, stringsEn);
  const borderColor = outgoing ? 'border-app-primary/30' : 'border-gray-100';

  const cardClassName = `max-w-[78%] px-3 py-2.5 rounded-2xl ${outgoing ? 'rounded-tr-md bg-app-primary/10' : 'rounded-tl-md bg-app-surface'} border ${borderColor} flex items-center gap-3 text-left ${fileRef ? 'active:opacity-80' : 'cursor-default'}`;
  const cardContent = (
    <>
      <FileIcon size={28} className={outgoing ? 'text-app-primary' : 'text-gray-500'} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium truncate text-app-text">{fileName}</div>
        {fileSize != null ? (
          <div className="text-[11px] text-gray-400">
            {formatFileSize(fileSize, {
              mb: s.file_size_mb,
              kb: s.file_size_kb,
              bytes: s.file_size_bytes,
            })}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
      {fileRef ? (
        <button
          type="button"
          data-action="sms.attachment.open"
          data-action-type="tap"
          data-action-params={JSON.stringify({ messageId, fileId: fileRef.fileId })}
          onClick={() => { if (!openFileRefInViewer(fileRef)) onOpenError(); }}
          className={cardClassName}
        >
          {cardContent}
        </button>
      ) : (
        <div className={cardClassName} aria-disabled="true">
          {cardContent}
        </div>
      )}
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
        void version;
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
  onOpenError: () => void;
}> = ({ message, onOpenError }) => {
  const s = useAppStrings(strings, stringsEn);
  const msgType = message.type || 'text';
  if (msgType === 'image') {
    return (
      <ImageBubble
        messageId={message.id}
        outgoing={message.isOutgoing}
        src={message.content}
        fileRef={message.fileRef}
        timestamp={message.timestamp}
        status={message.status}
        onOpenError={onOpenError}
      />
    );
  }
  if (msgType === 'file') {
    return (
      <FileBubble
        messageId={message.id}
        outgoing={message.isOutgoing}
        fileName={message.fileName || s.attachment_file}
        fileSize={message.fileSize}
        mimeType={message.mimeType}
        timestamp={message.timestamp}
        status={message.status}
        fileRef={message.fileRef}
        onOpenError={onOpenError}
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
    const [sending, setSending] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const sendingRef = useRef(false);

    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!conversationId) return;
        markConversationRead(conversationId);
    }, [conversationId]);

    useEffect(() => {
        // Scroll to bottom on first open & when new message arrives
        const el = listRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const canSend = text.trim().length > 0 && !!conversationId && !!conversation && !sending;
    const handleSend = () => {
        if (sendingRef.current || !canSend || !conversationId || !conversation) return;
        sendingRef.current = true;
        setSending(true);
        const content = text.trim();
        setText('');
        setShowAttachments(false);
        sendMessage(conversationId, content);
        window.requestAnimationFrame(() => {
            sendingRef.current = false;
            setSending(false);
        });
    };

    // Image picker via OS MediaService
    const handleSelectImage = async () => {
      setShowAttachments(false);
      try {
        const result = await MediaService.pickMedia({ type: 'image', multiple: true, maxSelect: 9 });
        if (result.cancelled || !result.selected.length || !conversationId) return;
        // Use item.id (stable node ID → getNodeById) to create proper FileRefV1
        // with fileName + fileRef, matching NewMessagePage's flow which
        // correctly stores metadata for rendering + judging.
        const inputs = result.selected.map((item) => item.id);
        const payload = createFileSharePayload(inputs);
        if (!payload.files.length) return;
        const cloned = await clonePayloadForApp(payload, 'sms');
        sendSharedAttachments(conversationId, cloned.files);
      } catch (err) {
        console.error('[SMS] handleSelectImage failed:', err);
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
                        <MessageBubble
                            key={m.id}
                            message={m}
                            onOpenError={() => {
                                setToast(s.attachment_unavailable);
                                window.setTimeout(() => setToast(null), 2200);
                            }}
                        />
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
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                if (!e.repeat && !e.nativeEvent.isComposing && canSend) handleSend();
                            }}
                            className="flex-1 text-[14px] text-app-text outline-none"
                            placeholder={s.sms_placeholder}
                        />
                    </div>

                    <button
                        type="button"
                        className={`w-11 h-11 flex items-center justify-center rounded-full ${canSend ? 'bg-app-primary' : 'bg-gray-200'
                            }`}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={handleSend}
                        data-action="sms.conversation.send"
                        data-action-type="tap"
                        disabled={!canSend}
                    >
                        <SendArrowIcon active={canSend} />
                    </button>
                </div>
            </div>
            <Toast message={toast ?? ''} visible={Boolean(toast)} />
        </div>
    );
};
