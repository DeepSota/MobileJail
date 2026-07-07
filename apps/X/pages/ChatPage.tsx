import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLocale } from '@/os/locale';
import { useKeyboard } from '../../../os/keyboard';
import * as TimeService from '../../../os/TimeService';
import * as MediaService from '../../../os/MediaService';
import { IcImage, IcInfo, IcNavBack, IcSendArrow } from '../res/icons';
import { dimens } from '../res/dimens';
import { useXStore, selectUser } from '../state';
import { useXResolvedPost } from '../data/view';
import { useXConversations } from '../data/view';
import { useXGestures } from '../hooks/useXGestures';
import { useXStrings } from '../hooks/useXStrings';

const ForwardedPostBubble: React.FC<{ postId: string; isMe: boolean; time: string }> = ({ postId, isMe, time }) => {
  const post = useXResolvedPost(postId);
  const { bindTap } = useXGestures();
  const s = useXStrings();

  if (!post) {
    return (
      <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white rounded-br-sm' : 'bg-gray-100 text-app-text rounded-bl-sm'}`}>
        {s.share_post_unavailable}
        <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>{time}</div>
      </div>
    );
  }

  const postImages = post.images ?? (post.image ? [post.image] : []);

  return (
    <div
      className={`max-w-[75%] rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
      {...bindTap('post.open', { params: { id: post.id } })}
    >
      <div className={`px-3 py-2 ${isMe ? 'bg-blue-500 text-white' : 'bg-gray-100 text-app-text'}`}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-5 h-5 rounded-full bg-gray-200 overflow-hidden shrink-0">
            {post.author?.avatar ? (
              <img src={post.author.avatar} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          <span className="font-bold text-xs truncate">{post.author?.name ?? ''}</span>
          {post.author?.verified && <span className="text-blue-400 text-[10px]">✓</span>}
        </div>
        <div className="text-xs line-clamp-3 whitespace-pre-wrap">{post.content}</div>
        {postImages.length > 0 && (
          <div className="mt-1 rounded-lg overflow-hidden">
            <img src={postImages[0]} alt="" className="max-h-[100px] object-cover w-full rounded-lg" />
          </div>
        )}
        <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>{time}</div>
      </div>
    </div>
  );
};

export const ChatPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const conversations = useXConversations();
  const sendMessage = useXStore(s => s.sendMessage);
  const sendImageMessage = useXStore(s => s.sendImageMessage);
  const user = useXStore(selectUser);
  const [inputValue, setInputValue] = useState('');
  const [pickingImage, setPickingImage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevKeyboardHeightRef = useRef(0);
  const { bindBack, bindTap } = useXGestures();
  const { height: keyboardHeight } = useKeyboard();
  const s = useXStrings();
  const locale = useLocale();

  const conversation = conversations.find(item => item.id === id);
  const joinedTimestamp = TimeService.parseToTimestamp('2010-12-28 00:00:00');
  const joinedDate = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: locale === 'en' ? 'long' : 'numeric',
    day: 'numeric',
  }).format(TimeService.fromTimestamp(joinedTimestamp));

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  };

  useLayoutEffect(() => {
    scrollToBottom(true);
  }, [conversation?.messages]);

  useEffect(() => {
    if (keyboardHeight > 0 && prevKeyboardHeightRef.current === 0) {
      const timer = setTimeout(() => scrollToBottom(true), 50);
      prevKeyboardHeightRef.current = keyboardHeight;
      return () => clearTimeout(timer);
    }
    prevKeyboardHeightRef.current = keyboardHeight;
  }, [keyboardHeight]);

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-app-bg text-app-text">
        <p>{s.chat_not_found}</p>
        <button {...bindBack()} className="mt-4 text-blue-500">{s.chat_back}</button>
      </div>
    );
  }

  const handleSend = () => {
    if (!inputValue.trim()) return;
    sendMessage(conversation.id, inputValue);
    setInputValue('');
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handlePickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: false, maxSelect: 1 });
      if (!result.cancelled && result.selected.length > 0) {
        sendImageMessage(conversation.id, result.selected[0].uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-app-bg text-app-text pt-10">
      <div className="flex items-center px-4 py-2 border-b border-app-border shrink-0">
        <button {...bindBack()} className="mr-4" aria-label={s.chat_back}>
          <IcNavBack size={20} />
        </button>
        <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden mr-3">
          {conversation.participant.avatar ? (
            <img src={conversation.participant.avatar} alt={conversation.participant.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-pink-600 font-bold text-white">
              {conversation.participant.name[0]}
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="font-bold text-sm flex items-center gap-1">
            {conversation.participant.name}
            {conversation.participant.verified && <span className="text-blue-400">✓</span>}
          </div>
          <div className="text-gray-500 text-xs">{`@${conversation.participant.id}`}</div>
        </div>
        <IcInfo size={20} className="text-app-text" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex flex-col items-center py-8 border-b border-app-border mb-4">
          <div className="w-16 h-16 rounded-full bg-gray-200 overflow-hidden mb-3">
            {conversation.participant.avatar ? (
              <img src={conversation.participant.avatar} alt={conversation.participant.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-pink-600 font-bold text-2xl text-white">
                {conversation.participant.name[0]}
              </div>
            )}
          </div>
          <div className="font-bold text-lg flex items-center gap-1">
            {conversation.participant.name}
            {conversation.participant.verified && <span className="text-blue-400">✓</span>}
          </div>
          <div className="text-gray-500 text-sm mb-4">{`@${conversation.participant.id}`}</div>
          <div className="text-gray-500 text-sm mb-4">
            {s.chat_joined_prefix}{joinedDate}
          </div>
        </div>

        {conversation.messages.map((message: any) => {
          const isMe = message.isMe;
          const isImage = message.type === 'image' && message.image;
          const isPost = message.type === 'post' && message.forwardedPostId;
          return (
            <div key={message.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              {!isMe && (
                <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden mr-2 self-end">
                  {conversation.participant.avatar ? (
                    <img src={conversation.participant.avatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-pink-600 text-xs text-white">
                      {conversation.participant.name[0]}
                    </div>
                  )}
                </div>
              )}
              {isImage ? (
                <div className={`max-w-[75%] rounded-2xl overflow-hidden ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
                  <img src={message.image} className="max-h-[11rem] object-contain w-full" alt="" />
                  <div className={`text-[10px] text-right px-2 py-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                    {message.time}
                  </div>
                </div>
              ) : isPost ? (
                <ForwardedPostBubble
                  postId={message.forwardedPostId}
                  isMe={isMe}
                  time={message.time}
                />
              ) : (
                <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm ${isMe ? 'bg-blue-500 text-white rounded-br-sm' : 'bg-gray-100 text-app-text rounded-bl-sm'}`}>
                  {message.content}
                  <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                    {message.time}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-app-border flex items-center gap-3 shrink-0" data-keep-keyboard="true">
        <button
          type="button"
          {...bindTap(
            { kind: 'action', id: 'chat.image.pick' },
            { onTrigger: handlePickImage },
          )}
          className="text-blue-400"
        >
          <IcImage size={dimens.compose_toolbar_icon_size} />
        </button>
        <div className="flex-1 bg-app-surface rounded-2xl px-4 py-2 flex items-center">
          <input
            type="text"
            className="bg-transparent border-none outline-none text-app-text w-full placeholder-gray-500"
            placeholder={s.chat_input_placeholder}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            data-action="chat.message.input"
            data-action-type="input"
            data-action-params={JSON.stringify({ value: inputValue })}
          />
          {inputValue && (
            <button
              {...bindTap(
                { kind: 'action', id: 'chat.message.send' },
                {
                  params: { conversationId: conversation.id, content: inputValue },
                  onTrigger: handleSend,
                },
              )}
              onPointerDown={(event) => event.preventDefault()}
              className="text-blue-500 ml-2"
              aria-label={s.chat_send_aria_label}
            >
              <IcSendArrow size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};