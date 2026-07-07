import { useRedBookStrings } from '../hooks/useRedBookStrings';
import React, { useState } from 'react';
import { IcLink, IcUserAdd, IcImage, IcContacts, IcFrown, IcMessageCircle, IcTabHome, IcStar, IcClose, IcMessage, IcSend, IcCheck, IcDownload } from '../res/icons';
import { useRedBookGestures } from '../hooks/useRedBookGestures';
import { useRedBookStore } from '../state';
import { useRedBookView } from '../data/view';
import { getBaseDataset } from '../data/loader';
import { Toast } from '@/os/components/Toast';

interface ShareModalProps {
  isOpen: boolean;
  noteId?: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, noteId }) => {
  const s = useRedBookStrings();
  const { bindBack, bindTap } = useRedBookGestures();
  const [showDMList, setShowDMList] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const chats = useRedBookStore(s => s.chats);
  const sendNoteMessage = useRedBookStore(s => s.sendNoteMessage);
  const userId = useRedBookStore(s => s.user.id);
  const followingIds = useRedBookStore(s => s.user.followingIds);
  const followerIds = useRedBookStore(s => s.user.followerIds);
  const view = useRedBookView();

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(''), 1800);
  };

  const handleCopyLink = () => {
    if (!noteId) return;
    const rand = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
    const url = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${rand}&xsec_source=pc_share`;
    const os = window.__OS__;
    if (os?.clipboard) {
      os.clipboard.copyText(url, 'redbook');
    }
    showToast(s.link_copied);
  };

  const handleDMSelect = (targetUserId: string) => {
    if (!noteId || sentIds.has(targetUserId)) return;
    sendNoteMessage(targetUserId, noteId);
    setSentIds(prev => {
      const next = new Set(prev);
      next.add(targetUserId);
      return next;
    });
  };

  const handleWeChat = () => {
    const os = window.__OS__;
    if (!os || !noteId) return;
    const note = view.notesById[noteId];
    if (!note) return;
    os.startActivity('wechat', {
      action: 'ACTION_SEND',
      type: 'image/*',
      data: {
        stream: note.images?.[0] ? [note.images[0]] : [],
        linkTitle: note.title || '',
        linkUrl: note.url || `https://www.xiaohongshu.com/explore/${note.id}`,
        linkSource: '小红书',
        __callerAppId: 'redbook',
      },
    });
    showToast('已分享到微信好友');
  };

  const handleMoments = () => {
    const os = window.__OS__;
    if (!os || !noteId) return;
    const note = view.notesById[noteId];
    if (!note) return;
    os.startActivity('wechat', {
      action: 'ACTION_SEND',
      type: 'image/*',
      route: '/post-moment',
      data: {
        stream: note.images?.[0] ? [note.images[0]] : [],
        text: note.title || '',
        __callerAppId: 'redbook',
      },
    });
    showToast('已分享到朋友圈');
  };

  // Build DM target list: existing chats + following + followers + base users
  const seenIds = new Set<string>();
  const dmTargets: { id: string; name: string; avatar: string; lastMessage?: string }[] = [];

  const addIfNew = (id: string, name: string, avatar: string, lastMessage?: string) => {
    if (!seenIds.has(id)) {
      seenIds.add(id);
      dmTargets.push({ id, name, avatar, lastMessage: lastMessage || undefined });
    }
  };

  // 1. Existing chats
  for (const chat of chats) {
    addIfNew(chat.userId, chat.username, chat.avatar, chat.lastMessage);
  }
  // 2. Following
  for (const fid of (followingIds || [])) {
    const u = view.usersById[fid];
    if (u && fid !== userId) addIfNew(u.id, u.name, u.avatar);
  }
  // 3. Followers
  for (const fid of (followerIds || [])) {
    const u = view.usersById[fid];
    if (u && fid !== userId) addIfNew(u.id, u.name, u.avatar);
  }
  // 4. Other base users (limit)
  for (const uid of view.userIds.slice(0, 30)) {
    const u = view.usersById[uid];
    if (u && uid !== userId) addIfNew(u.id, u.name, u.avatar);
  }

  // ── DM contact picker sub-view ──
  if (showDMList) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col justify-end">
        <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={() => setShowDMList(false)} />
        <div className="relative bg-white rounded-t-[16px] max-h-[60vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <IcMessage size={18} className="text-app-primary" />
              <span className="text-[16px] font-semibold text-app-text">{s.direct_message}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowDMList(false)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
            >
              <IcClose size={16} className="text-app-text-muted" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {dmTargets.length === 0 ? (
              <div className="px-4 py-8 text-center text-app-text-muted text-sm">
                No conversations yet
              </div>
            ) : (
              dmTargets.map((target) => {
                const isSent = sentIds.has(target.id);
                return (
                  <button
                    key={target.id}
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50"
                    disabled={isSent}
                    {...bindTap(
                      { kind: 'action', id: 'note.share.dm.send' },
                      { params: { noteId: noteId || '', userId: target.id }, onTrigger: () => handleDMSelect(target.id) },
                    )}
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden shrink-0">
                      {target.avatar ? (
                        <img src={target.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-app-primary flex items-center justify-center text-white font-bold">
                          {target.name?.[0] || '?'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-app-text truncate">
                        {target.name}
                      </div>
                      {target.lastMessage && (
                        <div className="text-[12px] text-app-text-muted truncate">
                          {target.lastMessage}
                        </div>
                      )}
                    </div>
                    {isSent ? (
                      <span className="text-green-500 text-xs font-bold flex items-center gap-1">
                        <IcCheck size={14} /> 已发送
                      </span>
                    ) : (
                      <IcSend size={16} className="text-app-primary shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main share sheet ──
  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 transition-opacity" {...bindBack()} />
      <div className="relative bg-[#f8f8f8] rounded-t-[16px] overflow-hidden animate-in slide-in-from-bottom duration-200">
        <div className="px-4 pb-8 pt-4 relative">
            <div className="text-center text-[16px] text-app-text mb-8 font-medium">{s.share_to}</div>
            <div className="absolute top-4 right-4 p-2 active:opacity-50" {...bindBack()}>
                <IcClose size={20} className="text-app-text-muted" strokeWidth={2} />
            </div>

            {/* Row 1: Invite */}
            <div className="grid grid-cols-5 gap-y-2 mb-6">
                <ShareItem
                    icon={<div className="w-full h-full bg-app-surface flex items-center justify-center text-app-text rounded-full"><IcUserAdd size={26} strokeWidth={1.5} /></div>}
                    label={s.invite_friends}
                />
                <div></div><div></div><div></div><div></div>
            </div>

            {/* Row 2: Social */}
            <div className="grid grid-cols-5 gap-y-2 mb-6">
                <div
                    className="flex flex-col items-center gap-2 w-full cursor-pointer active:opacity-70 transition-opacity"
                    onClick={() => setShowDMList(true)}
                >
                    <div className="w-[52px] h-[52px] rounded-full bg-app-primary flex items-center justify-center text-white"><IcMessage size={24} fill="white" strokeWidth={0} /></div>
                    <span className="text-[11px] text-[#666] whitespace-nowrap">{s.direct_message}</span>
                </div>
                <div
                    className="flex flex-col items-center gap-2 w-full cursor-pointer active:opacity-70 transition-opacity"
                    {...bindTap({ kind: 'action', id: 'note.share.wechat' }, { params: { noteId: noteId || '' }, onTrigger: handleWeChat })}
                >
                    <div className="w-[52px] h-[52px] rounded-full bg-[#07c160] flex items-center justify-center text-white"><IcMessageCircle size={28} fill="white" strokeWidth={0} /></div>
                    <span className="text-[11px] text-[#666] whitespace-nowrap">{s.wechat}</span>
                </div>
                <div
                    className="flex flex-col items-center gap-2 w-full cursor-pointer active:opacity-70 transition-opacity"
                    {...bindTap({ kind: 'action', id: 'note.share.moments' }, { params: { noteId: noteId || '' }, onTrigger: handleMoments })}
                >
                    <div className="w-[52px] h-[52px] rounded-full bg-[#6ccc43] flex items-center justify-center text-white"><IcTabHome size={28} fill="white" strokeWidth={0} /></div>
                    <span className="text-[11px] text-[#666] whitespace-nowrap">{s.moments}</span>
                </div>
                <ShareItem
                    icon={<div className="w-full h-full bg-[#12b7f5] flex items-center justify-center text-white rounded-full"><span className="font-bold text-base">{s.sharemodal_qq}</span></div>}
                    label={s.sharemodal_qq}
                />
                <ShareItem
                    icon={<div className="w-full h-full bg-[#fcc600] flex items-center justify-center text-white rounded-full"><IcStar size={26} fill="white" strokeWidth={0} /></div>}
                    label={s.qq_zone}
                />
            </div>

            {/* Row 3: Actions */}
            <div className="grid grid-cols-5 gap-y-2">
                <div
                    className="flex flex-col items-center gap-2 w-full cursor-pointer active:opacity-70 transition-opacity"
                    {...bindTap(
                      { kind: 'action', id: 'note.share.copyLink' },
                      { params: { noteId: noteId || '' }, onTrigger: handleCopyLink },
                    )}
                >
                    <div className="w-[52px] h-[52px] rounded-full bg-app-surface flex items-center justify-center">
                        <IcLink size={24} className="text-[#666]" strokeWidth={1.5} />
                    </div>
                    <span className="text-[11px] text-[#666] whitespace-nowrap">{s.copy_link}</span>
                </div>
                <ShareItem icon={<IcImage size={24} className="text-[#666]" strokeWidth={1.5} />} label={s.generate_share_image} bg="bg-app-surface" />
                <ShareItem icon={<IcContacts size={24} className="text-[#666]" strokeWidth={1.5} />} label={s.share_to_group} bg="bg-app-surface" />
                <ShareItem icon={<IcFrown size={24} className="text-[#666]" strokeWidth={1.5} />} label={s.not_interested} bg="bg-app-surface" />
                <ShareItem icon={<IcDownload size={24} className="text-[#666]" strokeWidth={1.5} />} label={s.save_image} bg="bg-app-surface" />
            </div>
        </div>
      </div>
      <Toast message={toastMsg} visible={!!toastMsg} />
    </div>
  );
};

const ShareItem = ({ icon, label, bg, onClick }: { icon: React.ReactNode, label: string, bg?: string, onClick?: () => void }) => (
    <div className="flex flex-col items-center gap-2 w-full cursor-pointer active:opacity-70 transition-opacity" onClick={onClick}>
        <div className={`w-[52px] h-[52px] rounded-full ${bg || ''} flex items-center justify-center`}>
            {icon}
        </div>
        <span className="text-[11px] text-[#666] whitespace-nowrap">{label}</span>
    </div>
);