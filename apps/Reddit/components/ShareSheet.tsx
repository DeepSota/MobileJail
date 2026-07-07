import React from 'react';
import { useRedditStore } from '../state';
import { IcShare, IcClose, IcCheck } from '../res/icons';
import { useRedditGestures } from '../hooks/useRedditGestures';
import { getUserAvatar } from '../utils/userIdentity';

interface ShareSheetProps {
  postId: string;
  sourceActionId?: string;
  onClose: () => void;
}

export const ShareSheet: React.FC<ShareSheetProps> = ({ postId, sourceActionId, onClose }) => {
  const chatThreads = useRedditStore((s) => s.chatThreads);
  const sharePost = useRedditStore((s) => s.sharePost);
  const { bindTap } = useRedditGestures();

  // Get all chat usernames
  const chatUsernames = Object.keys(chatThreads);
  const [sentUsername, setSentUsername] = React.useState<string | null>(null);

  const handleSelectChat = (username: string) => {
    if (sentUsername) return;
    sharePost(postId, username);
    setSentUsername(username);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-[92%] max-w-[400px] bg-white rounded-2xl max-h-[70vh] flex flex-col shadow-[0_10px_40px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <IcShare size={18} className="text-app-text" />
            <span className="text-[16px] font-semibold text-app-text">Forward post</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
          >
            <IcClose size={16} className="text-app-text-muted" />
          </button>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto py-2">
          {chatUsernames.length === 0 ? (
            <div className="px-4 py-8 text-center text-app-text-muted text-sm">
              No conversations yet
            </div>
          ) : (
            chatUsernames.map((username) => {
              const messages = chatThreads[username];
              const lastMsg = messages?.[messages.length - 1];
              const avatar = getUserAvatar(username);
              const isSent = sentUsername === username;
              return (
                <button
                  key={username}
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50"
                  {...bindTap(
                    { kind: 'action', id: sourceActionId || 'homeFeed.item.share' },
                    { params: { postId }, onTrigger: () => handleSelectChat(username) },
                  )}
                  disabled={!!sentUsername}
                >
                  <img
                    src={avatar || ''}
                    alt=""
                    className="w-10 h-10 rounded-full bg-gray-100 object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-app-text truncate">
                      {username}
                    </div>
                    <div className="text-[12px] text-app-text-muted truncate">
                      {lastMsg?.body || ''}
                    </div>
                  </div>
                  {isSent ? (
                    <span className="text-green-500 text-xs font-bold flex items-center gap-1">
                      <IcCheck size={14} /> Sent
                    </span>
                  ) : (
                    <IcShare size={16} className="text-app-text-muted shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};