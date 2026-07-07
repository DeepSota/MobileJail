import React from 'react';
import { IcClose, IcSend, IcShare } from '../res/icons';
import { useBilibiliStore } from '../state';
import { useBilibiliGestures } from '../hooks/useBilibiliGestures';
import { useVideos, useAuthors } from '../hooks/useData';
import { IcMessage } from '../res/icons';
import { resolveBilibiliDisplayName, resolveBilibiliAvatar } from '../utils/resolveDisplayName';

interface BShareSheetProps {
  videoId: string;
  onClose: () => void;
}

export const BShareSheet: React.FC<BShareSheetProps> = ({ videoId, onClose }) => {
  const sendVideoMessage = useBilibiliStore(s => s.sendVideoMessage);
  const shareVideo = useBilibiliStore(s => s.shareVideo);
  const chats = useBilibiliStore(s => s.chats);
  const user = useBilibiliStore(s => s.user);
  const videos = useVideos();
  const authors = useAuthors();
  const { go, bindTap } = useBilibiliGestures();
  const [sent, setSent] = React.useState<string | null>(null);

  const videoData = videos.find(v => v.id === videoId);
  const videoMeta = videoData ? { cover: videoData.cover, title: videoData.title, author: videoData.author } : undefined;

  // Build DM target list: existing chats + followingList / followersList / authors contacts not already in chats.
  // B站私信/转发界面展示昵称而非 UID —— 通过 resolveBilibiliDisplayName 解析名字。
  const allTargetIds = new Set<string>();

  // Deduplicate targets
  const addIfNew = (id: string, name: string, avatar: string, lastMessage?: string) => {
    if (!allTargetIds.has(id)) {
      allTargetIds.add(id);
      return { id, name, avatar, lastMessage };
    }
    return null;
  };

  const dmTargets = [
    // 1. Existing chats
    ...chats.map(c => addIfNew(
      c.userId,
      resolveBilibiliDisplayName(c.userId, user, c.username, undefined, authors),
      resolveBilibiliAvatar(c.userId, user, c.avatar, authors),
      c.lastMessage,
    )).filter(Boolean),
    // 2. Following list
    ...(user.followingList || []).map(u => addIfNew(String(u.mid), u.name, u.face)).filter(Boolean),
    // 3. Followers list
    ...(user.followersList || []).map(u => addIfNew(String(u.mid), u.name, u.face)).filter(Boolean),
    // 4. Authors (视频UP主)
    ...Object.entries(authors)
      .filter(([mid]) => !allTargetIds.has(mid) && !allTargetIds.has(String(mid)))
      .slice(0, 50)
      .map(([mid, info]) => addIfNew(String(mid), (info as any).name || '', (info as any).face || ''))
      .filter(Boolean),
  ] as { id: string; name: string; avatar: string; lastMessage?: string }[];

  const handleSelectDM = (targetId: string) => {
    shareVideo(videoId);
    sendVideoMessage(targetId, videoId, videoMeta);
    setSent(targetId);
    setTimeout(() => {
      onClose();
      go('video.share.chat.open', { userId: targetId });
    }, 500);
  };

  const handleWeChatFriend = () => {
    shareVideo(videoId);
    const os = window.__OS__;
    if (os) {
      os.startActivity('wechat', {
        action: 'ACTION_SEND',
        type: 'image/*',
        data: {
          stream: videoData?.cover ? [videoData.cover] : [],
          linkTitle: videoData?.title || '',
          linkUrl: `https://www.bilibili.com/video/${videoId}`,
          linkSource: 'bilibili',
          __callerAppId: 'bilibili',
        },
      });
    }
    onClose();
  };

  const handleMoments = () => {
    shareVideo(videoId);
    const os = window.__OS__;
    if (os) {
      os.startActivity('wechat', {
        action: 'ACTION_SEND',
        type: 'image/*',
        route: '/post-moment',
        data: {
          stream: videoData?.cover ? [videoData.cover] : [],
          text: videoData?.title || '',
          __callerAppId: 'bilibili',
        },
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-app-bg w-full max-w-md rounded-t-2xl overflow-hidden animate-in slide-in-from-bottom-10 fade-in-0 duration-200 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
          <span className="font-bold text-lg text-app-text">分享到</span>
          <button onClick={onClose} className="p-1 rounded-full active:bg-gray-200">
            <IcClose size={20} className="text-app-text" />
          </button>
        </div>

        {/* Quick share targets */}
        <div className="px-6 py-5 border-b border-app-border shrink-0">
          <div className="flex items-center gap-8 justify-center">
            {/* 微信好友 */}
            <div
              className="flex flex-col items-center gap-2 cursor-pointer active:opacity-70"
              {...bindTap(
                { kind: 'action', id: 'video.intro.share.wechat' },
                { onTrigger: handleWeChatFriend },
              )}
            >
              <div className="w-[52px] h-[52px] rounded-full bg-[#07c160] flex items-center justify-center text-white">
                <IcMessage size={26} fill="white" strokeWidth={0} />
              </div>
              <span className="text-[11px] text-[#666]">微信好友</span>
            </div>
            {/* 朋友圈 */}
            <div
              className="flex flex-col items-center gap-2 cursor-pointer active:opacity-70"
              {...bindTap(
                { kind: 'action', id: 'video.intro.share.moments' },
                { onTrigger: handleMoments },
              )}
            >
              <div className="w-[52px] h-[52px] rounded-full bg-[#6ccc43] flex items-center justify-center text-white">
                <IcShare size={24} />
              </div>
              <span className="text-[11px] text-[#666]">朋友圈</span>
            </div>
          </div>
        </div>

        {/* Bilibili DM list */}
        <div className="flex items-center justify-between px-4 py-2 shrink-0">
          <span className="font-medium text-sm text-app-text">B站私信</span>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {dmTargets.length === 0 ? (
            <div className="py-8 text-center text-gray-500">暂无联系人</div>
          ) : (
            dmTargets.map(target => {
              const isSent = sent === target.id;
              return (
                <button
                  key={target.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl active:bg-gray-100 transition-colors"
                  onClick={() => !isSent && handleSelectDM(target.id)}
                  disabled={isSent}
                >
                  <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    {target.avatar ? (
                      <img src={target.avatar} alt={target.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-[#00A1D6] flex items-center justify-center text-white font-bold">
                        {target.name?.[0] ?? '?'}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-medium text-app-text text-sm truncate">{target.name}</div>
                    {target.lastMessage && (
                      <div className="text-gray-500 text-xs truncate">{target.lastMessage}</div>
                    )}
                  </div>
                  {isSent ? (
                    <span className="text-green-500 text-xs font-bold">已发送</span>
                  ) : (
                    <IcSend size={18} className="text-[#00A1D6]" />
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