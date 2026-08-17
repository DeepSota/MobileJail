import React from 'react';
import { useParams } from 'react-router-dom';
import { IcCamera, IcChart, IcClose, IcImage, IcLocation, IcSmile } from '../res/icons';
import { useXStore, selectUser } from '../state';
import { useXAllUsers, useXLocalPosts, useXRepliesForPost, useXResolvedPost } from '../data/view';
import { useXGestures } from '../hooks/useXGestures';
import { useXStrings } from '../hooks/useXStrings';
import { XImage, XVideo } from '../components/XMedia';
import * as MediaService from '@/os/MediaService';

const MAX_IMAGES = 4;

const resizeReplyTextarea = (element: HTMLTextAreaElement) => {
  element.style.height = 'auto';
  const nextHeight = Math.min(element.scrollHeight, 240);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > 240 ? 'auto' : 'hidden';
};

export const ReplyPage: React.FC = () => {
  const { id } = useParams();
  const user = useXStore(selectUser);
  const localPosts = useXLocalPosts();
  const importedReplies = useXRepliesForPost(id || '');
  const allUsers = useXAllUsers();
  const original = useXResolvedPost(id || '');
  const addReply = useXStore(s => s.addReply);
  const { bindBack, bindTap, back } = useXGestures();
  const s = useXStrings();

  const replies = React.useMemo(() => {
    const dynamicReplies = localPosts.filter(post => post.threadId === id);
    const inlineReplies = Array.isArray(original?.replies) ? original.replies : [];
    const combined = [...importedReplies, ...inlineReplies, ...dynamicReplies];
    const seen = new Set<string>();

    return combined.filter(reply => {
      if (!reply?.id || seen.has(reply.id)) return false;
      seen.add(reply.id);
      return true;
    });
  }, [id, importedReplies, localPosts, original]);

  const [content, setContent] = React.useState('');
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [selectedImages, setSelectedImages] = React.useState<string[]>([]);
  const [pickingImage, setPickingImage] = React.useState(false);
  const trimmed = content.trim();

  React.useEffect(() => {
    if (inputRef.current) resizeReplyTextarea(inputRef.current);
  }, [content]);

  const handlePickImage = async () => {
    if (pickingImage) return;
    if (selectedImages.length >= MAX_IMAGES) return;
    setPickingImage(true);
    try {
      const remaining = MAX_IMAGES - selectedImages.length;
      const result = await MediaService.pickMedia({ type: 'image', multiple: true, maxSelect: remaining });
      if (!result.cancelled && result.selected.length > 0) {
        const uris = result.selected.map(item => item.uri).filter(Boolean);
        setSelectedImages(prev => [...prev, ...uris].slice(0, MAX_IMAGES));
      }
    } finally {
      setPickingImage(false);
    }
  };

  const handleRemoveImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  if (!original) {
    return (
      <div className="flex flex-col bg-app-bg min-h-full text-app-text pt-10 px-4">
        <div className="flex items-center justify-between py-2">
          <button className="text-app-text font-bold" {...bindBack()}>
            {s.reply_cancel}
          </button>
          <div className="font-bold text-lg">{s.reply_title}</div>
          <div className="w-12" />
        </div>
        <div className="mt-6 text-gray-500">{s.reply_not_found}</div>
      </div>
    );
  }

  const canSubmit = trimmed.length > 0 || selectedImages.length > 0;

  const submit = bindTap(
    { kind: 'action', id: 'reply.post.submit' },
    {
      params: { postId: original.id, content: trimmed },
      onTrigger: () => {
        if (!canSubmit) return;
        addReply(original.id, trimmed, selectedImages.length > 0 ? selectedImages : undefined);
        setContent('');
        setSelectedImages([]);
        window.requestAnimationFrame(() => {
          (document.activeElement as HTMLElement | null)?.blur?.();
        });
        back(1);
      },
    },
  );

  return (
    <div className="flex h-full flex-col bg-app-bg text-app-text pt-10">
      <div className="flex items-center justify-between px-4 py-2 border-b border-app-border">
        <button className="text-app-text font-bold" {...bindBack({ beforeTrigger: () => setContent('') })}>
          {s.reply_cancel}
        </button>
        <div className="font-bold text-lg">{s.reply_title}</div>
        <button className={`rounded-full px-4 py-1.5 font-bold text-sm ${canSubmit ? 'bg-blue-500 text-white' : 'bg-blue-500/40 text-white/60'}`} {...submit}>
          {s.reply_submit}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar" data-scroll-container="main" data-scroll-direction="vertical">
        <div className="px-4 py-4">
          <div className="flex">
            <div className="w-10 h-10 rounded-full bg-gray-200 mr-3 overflow-hidden shrink-0 cursor-pointer" {...bindTap('user.open.fromPost', { params: { id: original.authorId } })}>
              {original.author?.avatar ? (
                <XImage src={original.author.avatar} alt={original.author.name} className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="flex-1">
              <div className="flex items-center text-gray-500 text-sm flex-wrap">
                <span className="font-bold text-app-text mr-1">{original.author?.name}</span>
                {original.author?.verified ? <span className="text-blue-400 mr-1">✓</span> : null}
                <span className="mr-1">{original.author?.id ? `@${original.author.id}` : ''}</span>
                <span>· {original.time}</span>
              </div>
              <div className="mt-1 text-app-text whitespace-pre-wrap">{original.content}</div>
              {original.image ? (
                <div className="mt-2 rounded-xl overflow-hidden border border-app-border bg-app-surface w-full">
                  <XImage src={original.image} alt="Post image" className="w-full h-auto object-cover max-h-[420px]" />
                </div>
              ) : null}
              {original.video ? (
                <div className="mt-2 rounded-xl overflow-hidden border border-app-border bg-app-surface w-full">
                  <XVideo src={original.video} className="w-full h-auto max-h-[420px]" />
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-3 text-gray-500 text-sm">
            {s.reply_to_prefix}
            <span className="text-blue-400">{original.author?.id ? `@${original.author.id}` : ''}</span>
          </div>

          <div className="mt-4 flex">
            <div className="w-10 h-10 rounded-full bg-gray-200 mr-3 overflow-hidden shrink-0">
              {user.avatar ? (
                <XImage src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-pink-600 flex items-center justify-center text-white font-bold">
                  {user.name[0]}
                </div>
              )}
            </div>
            <div className="flex-1">
              <textarea
                ref={inputRef}
                rows={1}
                className="block w-full min-h-[140px] max-h-[240px] bg-transparent outline-none resize-none overflow-y-hidden text-app-text placeholder-gray-500 leading-5"
                placeholder={s.reply_placeholder}
                value={content}
                onChange={event => {
                  setContent(event.target.value);
                  resizeReplyTextarea(event.currentTarget);
                }}
                onInput={event => resizeReplyTextarea(event.currentTarget)}
                data-action="reply.content.input"
                data-action-type="input"
                data-action-params={JSON.stringify({ value: content })}
              />
              {selectedImages.length === 1 && (
                <div className="relative inline-block mt-2">
                  <img src={selectedImages[0]} alt="" className="max-h-[120px] rounded-xl object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(0)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-gray-800/70 rounded-full flex items-center justify-center text-white"
                  >
                    <IcClose size={14} />
                  </button>
                </div>
              )}
              {selectedImages.length > 1 && (
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl overflow-hidden">
                  {selectedImages.map((src, i) => (
                    <div key={i} className="relative">
                      <img src={src} alt="" className="w-full aspect-square object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(i)}
                        className="absolute top-1 right-1 w-6 h-6 bg-gray-800/70 rounded-full flex items-center justify-center text-white"
                      >
                        <IcClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {replies.length > 0 && (
            <div className="mt-6 pt-4 border-t border-app-border">
              {replies.map(reply => {
                const replyAuthor = (reply as any).author ?? allUsers[reply.authorId];
                const replyImages = reply.images ?? (reply.image ? [reply.image] : []);
                return (
                  <div key={reply.id} className="flex gap-3 mb-6">
                    <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0">
                      {replyAuthor?.avatar ? (
                        <XImage src={replyAuthor.avatar} alt={replyAuthor.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center font-bold">
                          {replyAuthor?.name?.[0]}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm text-gray-500 mb-0.5">
                        <span className="text-app-text font-bold">{replyAuthor?.name}</span>
                        <span>{replyAuthor?.id ? `@${replyAuthor.id}` : ''}</span>
                        <span>· {reply.time}</span>
                      </div>
                      <div className="text-app-text text-[15px] whitespace-pre-wrap">{reply.content}</div>
                      {replyImages.length === 1 && (
                        <div className="mt-2 rounded-xl overflow-hidden border border-app-border bg-app-surface w-fit">
                          <XImage src={replyImages[0]} alt="" className="max-h-[200px] object-cover" />
                        </div>
                      )}
                      {replyImages.length > 1 && (
                        <div className="mt-2 grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden border border-app-border w-fit">
                          {replyImages.map((src: string, i: number) => (
                            <XImage key={i} src={src} alt="" className="w-[120px] h-[120px] object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-app-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-5 text-blue-400">
          <button
            type="button"
            {...bindTap({ kind: 'action', id: 'reply.image.pick' }, { onTrigger: handlePickImage })}
            className="active:opacity-70"
          >
            <IcImage size={20} />
          </button>
          <div className="cursor-pointer active:opacity-70"><IcCamera size={20} /></div>
          <div className="cursor-pointer active:opacity-70"><IcSmile size={20} /></div>
          <div className="cursor-pointer active:opacity-70"><IcChart size={20} /></div>
          <div className="cursor-pointer active:opacity-70"><IcLocation size={20} /></div>
        </div>
        <div className="text-gray-600 text-sm">0</div>
      </div>
    </div>
  );
};
