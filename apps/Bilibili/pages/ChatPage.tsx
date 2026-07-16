import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useBilibiliStore } from '../state';
import { useVideos, useAuthors } from '../hooks/useData';
import { useBilibiliGestures } from '../hooks/useBilibiliGestures';
import { IcNavBack, IcImage, IcSend } from '../res/icons';
import * as MediaService from '@/os/MediaService';
import { useKeyboard } from '@/os/keyboard';
import { resolveBilibiliDisplayName } from '../utils/resolveDisplayName';
import { SharedFileImage } from '@/os/components/SharedFileImage';
import { createViewIntent, openFileRefInViewer } from '@/os/FileShareService';
import { useBilibiliStrings } from '../hooks/useBilibiliStrings';

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const SharedVideoBubble: React.FC<{
  videoId: string;
  isMe: boolean;
  cover?: string;
  title?: string;
  author?: string;
}> = ({ videoId, isMe, cover, title, author }) => {
  const videos = useVideos();
  const { bindTap } = useBilibiliGestures();

  // Prefer embedded metadata, fall back to async video lookup
  const video = videos.find(v => v.id === videoId);
  const displayCover = cover || video?.cover;
  const displayTitle = title || video?.title || videoId;
  const displayAuthor = author || video?.author || 'UP主';

  return (
    <div
      className={`max-w-[70%] rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
      {...bindTap('video.open', { params: { bvid: videoId } })}
    >
      <div className={`px-3 py-2 ${isMe ? 'bg-[#00A1D6] text-white' : 'bg-gray-100 text-app-text'}`}>
        <div className="flex items-center gap-2 mb-1">
          {displayCover && (
            <img src={displayCover} alt="" className="w-14 h-10 rounded object-cover shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium line-clamp-2">{displayTitle}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{displayAuthor}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ChatPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const user = useBilibiliStore(s => s.user);
  const chats = useBilibiliStore(s => s.chats);
  const sendMessage = useBilibiliStore(s => s.sendMessage);
  const sendImageMessage = useBilibiliStore(s => s.sendImageMessage);
  const { bindTap, bindBack } = useBilibiliGestures();
  const { height: keyboardHeight } = useKeyboard();
  const authors = useAuthors();
  const s = useBilibiliStrings();

  const chat = chats.find(c => c.userId === userId);
  const displayName = resolveBilibiliDisplayName(userId || '', user, chat?.username, undefined, authors);
  const [input, setInput] = useState('');
  const [pickingImage, setPickingImage] = useState(false);
  const [attachmentToast, setAttachmentToast] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevKeyboardHeightRef = useRef(0);

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  };

  useLayoutEffect(() => {
    scrollToBottom(true);
  }, [chat?.messages]);

  useEffect(() => {
    if (keyboardHeight > 0 && prevKeyboardHeightRef.current === 0) {
      const timer = setTimeout(() => scrollToBottom(true), 50);
      prevKeyboardHeightRef.current = keyboardHeight;
      return () => clearTimeout(timer);
    }
    prevKeyboardHeightRef.current = keyboardHeight;
  }, [keyboardHeight]);

  const handleSend = () => {
    if (!input.trim() || !userId) return;
    sendMessage(userId, input);
    setInput('');
  };

  const handlePickImage = async () => {
    if (pickingImage || !userId) return;
    setPickingImage(true);
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: false, maxSelect: 1 });
      if (!result.cancelled && result.selected.length > 0) {
        sendImageMessage(userId, result.selected[0].uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  const showAttachmentUnavailable = useCallback(() => {
    setAttachmentToast(s.file_attachment_unavailable);
    window.setTimeout(() => {
      setAttachmentToast(current => current === s.file_attachment_unavailable ? '' : current);
    }, 2500);
  }, [s.file_attachment_unavailable]);

  const messages = chat?.messages || [];
  const canSend = input.trim().length > 0;
  const myId = String(user.uid || user.name);

  return (
    <div className="relative flex flex-col h-full bg-app-surface">
      {/* Header */}
      <div className="pt-10 px-4 pb-3 flex items-center border-b border-gray-100">
        <button className="w-8 h-8 flex items-center justify-start" {...bindBack()}>
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <div className="flex-1 text-center text-[17px] font-medium text-app-text">
          {displayName}
        </div>
        <div className="w-8" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" data-scroll-container="main" data-scroll-direction="vertical">
        {messages.map(msg => {
          const isSystem = msg.senderId === 'system';
          const isMe = msg.senderId === myId;
          const isImage = msg.type === 'image' && msg.image;
	          const isSharedFile = msg.fileRef;
	          const isVideo = msg.type === 'video' && msg.sharedVideoId;

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-[12px] text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              {isSharedFile && msg.type === 'image' ? (
                <button
                  type="button"
                  {...bindTap(
                    { kind: 'action', id: 'chat.file.open' },
                    {
                      params: { fileId: isSharedFile.fileId },
                      onTrigger: () => {
                        const intent = createViewIntent(isSharedFile);
                        const opened = intent ? window.__OS__?.startActivity('gallery', intent) : false;
                        if (!opened) showAttachmentUnavailable();
                      },
                    },
                  )}
                  aria-label={s.file_attachment_open}
                  className={`max-w-[70%] rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                >
                  <span className="relative block min-w-24 min-h-20 bg-gray-100">
                    <span className="absolute inset-0 grid place-items-center px-2 text-center text-[12px] text-gray-500">
                      {s.file_attachment_unavailable}
                    </span>
                    <SharedFileImage fileRef={isSharedFile} className="relative z-10 max-h-[11rem] object-contain w-full" alt={isSharedFile.name} />
                  </span>
                </button>
              ) : isSharedFile ? (
                <button
                  type="button"
                  {...bindTap(
                    { kind: 'action', id: 'chat.file.open' },
                    {
                      params: { fileId: isSharedFile.fileId },
                      onTrigger: () => {
                        if (!openFileRefInViewer(isSharedFile)) showAttachmentUnavailable();
                      },
                    },
                  )}
                  aria-label={`${s.file_attachment_open}: ${isSharedFile.name}`}
                  className={`max-w-[17rem] min-w-[14rem] px-3 py-3 rounded-2xl flex items-center gap-3 text-left ${isMe ? 'bg-[#00A1D6] text-white rounded-br-sm' : 'bg-gray-100 text-app-text rounded-bl-sm'}`}
                >
                  <span className={`w-11 h-12 rounded-lg grid place-items-center text-[11px] font-bold uppercase shrink-0 ${isMe ? 'bg-white/20' : 'bg-white text-[#00A1D6]'}`}>
                    {isSharedFile.name.split('.').pop()?.slice(0, 4) || 'FILE'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{isSharedFile.name}</span>
                    <span className={`block mt-1 text-[11px] ${isMe ? 'text-white/70' : 'text-gray-400'}`}>{formatFileSize(isSharedFile.size)}</span>
                  </span>
                </button>
              ) : isImage ? (
                <div className={`max-w-[70%] rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
                  <img src={msg.image} className="max-h-[11rem] object-contain w-full" alt="" />
                </div>
              ) : isVideo ? (
                <SharedVideoBubble
                  videoId={msg.sharedVideoId!}
                  isMe={isMe}
                  cover={msg.sharedVideoCover}
                  title={msg.sharedVideoTitle}
                  author={msg.sharedVideoAuthor}
                />
              ) : (
                <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed ${
                  isMe
                    ? 'bg-[#00A1D6] text-white rounded-br-sm'
                    : 'bg-gray-100 text-app-text rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-app-surface px-4 py-2 flex items-center gap-3" data-keep-keyboard="true">
        <button
          type="button"
          aria-label="Pick image"
          {...bindTap(
            { kind: 'action', id: 'chat.image.pick' },
            { onTrigger: handlePickImage },
          )}
          className="text-gray-400 active:text-gray-600 flex-shrink-0"
        >
          <IcImage size={22} />
        </button>
        <div className="flex-1 bg-gray-100 rounded-full h-9 flex items-center px-4">
          <input
            className="w-full bg-transparent text-[15px] text-app-text outline-none placeholder-gray-400"
            placeholder="发送消息"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
        </div>
        <button
          type="button"
          disabled={!canSend}
          data-keep-keyboard="true"
          onMouseDown={e => e.preventDefault()}
          onPointerDown={e => e.preventDefault()}
          {...bindTap(
            { kind: 'action', id: 'chat.send.submit' },
            { onTrigger: handleSend },
          )}
          className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
            canSend ? 'bg-[#00A1D6] text-white' : 'bg-gray-200 text-gray-400'
          }`}
        >
          <IcSend size={18} />
        </button>
      </div>
      {attachmentToast && (
        <div role="status" className="absolute left-1/2 bottom-20 z-50 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-[13px] text-white shadow-lg">
          {attachmentToast}
        </div>
      )}
    </div>
  );
};

export default ChatPage;
