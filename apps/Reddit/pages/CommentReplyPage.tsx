import React from 'react';
import { IcClose, IcLink, IcImage, IcSticker, IcSend } from '../res/icons';
import { useLocation } from 'react-router-dom';
import { useRedditStore } from '../state';
import { useRedditGestures } from '../hooks/useRedditGestures';
import * as TimeService from '../../../os/TimeService';
import { useRedditComments } from '../hooks/useRedditComments';
import * as MediaService from '@/os/MediaService';
import type { Comment } from '../types';

function getIdsFromPath(pathname: string): { postId: string; commentId: string } | null {
  const m = pathname.match(/^\/post\/([^/?#]+)\/reply\/([^/?#]+)/);
  if (!m) return null;
  return { postId: decodeURIComponent(m[1]), commentId: decodeURIComponent(m[2]) };
}

function formatAge(createdUtc?: number): string {
  if (!createdUtc) return '';
  const now = Math.floor(TimeService.now() / 1000);
  const d = Math.max(0, now - createdUtc);
  const day = Math.floor(d / 86400);
  if (day >= 1) return `${day}d`;
  const h = Math.floor(d / 3600);
  if (h >= 1) return `${h}h`;
  const m = Math.floor(d / 60);
  if (m >= 1) return `${m}m`;
  return 'now';
}

export const CommentReplyPage: React.FC = () => {
  const storeAddReplyComment = useRedditStore((s) => s.addReplyComment);
  const { bindBack, bindTap, back } = useRedditGestures();
  const location = useLocation();
  const ids = getIdsFromPath(location.pathname);
  const postId = ids?.postId ?? null;
  const commentId = ids?.commentId ?? null;

  const [text, setText] = React.useState('');
  const [replyImage, setReplyImage] = React.useState<string | null>(null);
  const [pickingImage, setPickingImage] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handlePickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: false, maxSelect: 1 });
      if (!result.cancelled && result.selected.length > 0) {
        setReplyImage(result.selected[0].uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  const allComments = useRedditComments(postId);

  const targetComment = React.useMemo(() => {
    if (!commentId) return null;
    return allComments.find((c: Comment) => c.id === commentId) ?? null;
  }, [allComments, commentId]);

  const canPost = (text.trim().length > 0 || !!replyImage) && !!postId && !!commentId;

  const submit = React.useCallback(() => {
    if (!postId || !commentId) return;
    const body = text.trim();
    if (!body && !replyImage) return;

    storeAddReplyComment(postId, commentId, body, replyImage || undefined);

    back(); // return to comments page
  }, [back, commentId, postId, storeAddReplyComment, text, replyImage]);

  return (
    <div className="flex flex-col h-full bg-app-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-10 pb-3 border-b border-gray-100">
        <button
          type="button"
          aria-label="Close"
          className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center active:bg-gray-100"
          {...bindBack()}
        >
          <IcClose className="w-6 h-6 text-gray-800" strokeWidth={2} />
        </button>

        <div className="text-[18px] font-bold text-app-text">Reply</div>

        <button
          type="button"
          onClick={() => {}}
          {...bindTap(
            { kind: 'action', id: 'commentReply.post.submit' },
            {
              params: { postId: postId ?? '', commentId: commentId ?? '', body: text },
              onTrigger: submit,
            },
          )}
          className={`text-[15px] font-bold ${canPost ? 'text-[#0045AC]' : 'text-gray-300'}`}
        >
          Post
        </button>
      </div>

      {/* Context: the comment being replied to */}
      <div className="px-4 pt-4">
        <div className="text-[14px] text-gray-600">
          <span className="font-semibold text-app-text">{targetComment?.author ?? 'Unknown'}</span>
          {targetComment?.created_utc ? <span className="text-gray-400"> • {formatAge(targetComment.created_utc)}</span> : null}
        </div>
        <div className="mt-2 text-[16px] text-app-text leading-relaxed">
          {targetComment?.body ?? ''}
        </div>
        {targetComment?.image && (
          <div className="mt-2 rounded-lg overflow-hidden w-fit">
            <img src={targetComment.image} alt="" className="max-h-[100px] object-contain rounded-lg" />
          </div>
        )}

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your reply"
          className="mt-4 w-full min-h-[140px] text-[16px] text-app-text placeholder-gray-400 outline-none resize-none"
        />

        {replyImage && (
          <div className="relative inline-block mt-2">
            <img src={replyImage} alt="" className="max-h-[120px] rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setReplyImage(null)}
              className="absolute -top-1 -right-1 w-5 h-5 bg-gray-800/70 rounded-full flex items-center justify-center text-white"
            >
              <IcClose size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Bottom toolbar */}
      <div className="border-t border-gray-100 bg-app-surface px-5 py-3 flex items-center justify-between text-gray-600">
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => {}} aria-label="Link" className="w-10 h-10 rounded-full flex items-center justify-center active:bg-gray-100">
            <IcLink className="w-6 h-6" strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => {}} aria-label="GIF" className="h-10 px-3 rounded-full border border-app-border text-[13px] font-bold text-gray-600 active:bg-gray-100">
            GIF
          </button>
          <button
            type="button"
            {...bindTap(
              { kind: 'action', id: 'commentReply.image.pick' },
              { onTrigger: handlePickImage },
            )}
            aria-label="Image"
            className="w-10 h-10 rounded-full flex items-center justify-center active:bg-gray-100"
          >
            <IcImage className="w-6 h-6" strokeWidth={2} />
          </button>
          <button type="button" onClick={() => {}} aria-label="Sticker" className="w-10 h-10 rounded-full flex items-center justify-center active:bg-gray-100">
            <IcSticker className="w-6 h-6" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};