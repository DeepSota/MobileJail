import { createAppStoreWithActions, memoSelector } from '../../os/createAppStore';
import { BILIBILI_CONFIG } from './data';
import type { BilibiliUser, BilibiliSettings, CommentReply, BilibiliChatConversation, BilibiliChatMessage, BilibiliDynamic, BilibiliDanmaku } from './types';
import * as TimeService from '../../os/TimeService';
import { getAuthorsSync } from './data/loader';
import type { FileRefV1 } from '@/os/types/fileShare';
import { resolveBilibiliStateStrings } from './utils/stateStrings';

const simNow = TimeService.now;

// ---- Helpers ----

function deepSet<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: string | boolean,
): T {
  const keys = path.split('.');
  if (keys.length === 1) return { ...obj, [keys[0]!]: value } as T;
  const [head, ...rest] = keys;
  const next =
    obj[head!] != null &&
    typeof obj[head!] === 'object' &&
    !Array.isArray(obj[head!])
      ? (obj[head!] as Record<string, unknown>)
      : {};
  return {
    ...obj,
    [head!]: deepSet(next, rest.join('.'), value),
  } as T;
}

const FIVE_MINUTES = 5 * 60 * 1000;

function formatChatTimeSeparator(nowTs: number): string {
  const date = TimeService.fromTimestamp(nowTs);
  const now = TimeService.getDate();
  const diff = now.getTime() - date.getTime();
  if (diff < 24 * 3600 * 1000 && date.getDate() === now.getDate()) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function upsertChatMessages(
  chats: BilibiliChatConversation[],
  toUserId: string,
  user: BilibiliUser,
  language: string | null,
  nowTs: number,
  outgoingMessages: BilibiliChatMessage[],
  options?: { username?: string; avatar?: string },
): BilibiliChatConversation[] {
  const stateStrings = resolveBilibiliStateStrings(language);
  const updatedChats = [...chats];
  const chatIndex = updatedChats.findIndex(c => c.userId === toUserId);

  const messagesToAppend: BilibiliChatMessage[] = [];
  if (chatIndex !== -1) {
    const lastMsg = updatedChats[chatIndex].messages[updatedChats[chatIndex].messages.length - 1];
    if (!lastMsg || nowTs - lastMsg.timestamp > FIVE_MINUTES) {
      messagesToAppend.push({
        id: `time-${nowTs}`,
        senderId: 'system',
        content: formatChatTimeSeparator(nowTs),
        timestamp: nowTs - 1,
        type: 'text',
      });
    }
  } else {
    messagesToAppend.push({
      id: `time-${nowTs}`,
      senderId: 'system',
      content: formatChatTimeSeparator(nowTs),
      timestamp: nowTs - 1,
      type: 'text',
    });
  }
  messagesToAppend.push(...outgoingMessages);

  if (chatIndex !== -1) {
    const chat = { ...updatedChats[chatIndex] };
    chat.messages = [...chat.messages, ...messagesToAppend];
    const lastOutgoing = outgoingMessages[outgoingMessages.length - 1];
    chat.lastMessage = lastOutgoing?.type === 'image' ? stateStrings.chat_image_placeholder : lastOutgoing?.type === 'video' ? '[视频]' : (lastOutgoing?.content || '');
    chat.lastTime = nowTs;
    updatedChats.splice(chatIndex, 1);
    updatedChats.unshift(chat);
    return updatedChats;
  }

  const lastOutgoing = outgoingMessages[outgoingMessages.length - 1];
  // 解析昵称与头像：options → followingList → followersList → authors
  let resolvedName = options?.username || '';
  let resolvedAvatar = options?.avatar || '';
  if (!resolvedName || !resolvedAvatar) {
    const target = user.followingList?.find(u => String(u.mid) === toUserId)
      || user.followersList?.find(u => String(u.mid) === toUserId);
    if (!resolvedName && target?.name) resolvedName = target.name;
    if (!resolvedAvatar && target?.face) resolvedAvatar = target.face;
  }
  if (!resolvedName || !resolvedAvatar) {
    const authors = getAuthorsSync();
    if (authors) {
      const authorInfo = authors[Number(toUserId)];
      if (!resolvedName && authorInfo?.name) resolvedName = authorInfo.name;
      if (!resolvedAvatar && authorInfo?.face) resolvedAvatar = authorInfo.face;
    }
  }
  updatedChats.unshift({
    userId: toUserId,
    username: resolvedName,
    avatar: resolvedAvatar,
    unreadCount: 0,
    lastMessage: lastOutgoing?.type === 'image' ? stateStrings.chat_image_placeholder : lastOutgoing?.type === 'video' ? '[视频]' : (lastOutgoing?.content || ''),
    lastTime: nowTs,
    messages: messagesToAppend,
  });
  return updatedChats;
}

// ---- Types ----

interface BilibiliState {
  user: BilibiliUser;
  activeVideoId: string | null;
  settings: BilibiliSettings;
  userComments: Record<string, CommentReply[]>;
  chats: BilibiliChatConversation[];
  dynamics: BilibiliDynamic[];
  danmaku: Record<string, BilibiliDanmaku[]>;
  danmakuVisible: boolean;
}

interface BilibiliActions {
  // User
  updateUser: (updates: Partial<BilibiliUser>) => void;

  // Settings (persisted with user)
  setSetting: (key: string, value: string | boolean) => void;

  // Active video
  setActiveVideoId: (id: string | null) => void;

  // Follow
  toggleFollow: (id: string | number) => void;

  // Video interactions
  toggleLike: (vid: string) => void;
  toggleDislike: (vid: string) => void;
  addCoin: (vid: string, count: number, alsoLike: boolean) => { success: boolean; msg: string };
  toggleFav: (vid: string) => void;
  /** 批量设置视频在哪些收藏夹中（selectedIds 为选中的收藏夹 id 集合） */
  setFavFolders: (vid: string, selectedIds: string[]) => void;
  /** 新建收藏夹，返回新建的 folder id */
  createFavFolder: (title: string, description?: string, isPublic?: boolean) => string;
  tripleAction: (vid: string) => { success: boolean; msg: string };

  // Anime/Drama subscription
  toggleAnime: (id: string, title?: string) => void;
  toggleDrama: (id: string, title?: string) => void;

  // Search history
  addSearchHistory: (keyword: string) => void;
  clearSearchHistory: () => void;

  // Comments
  addComment: (bvid: string, message: string, images?: string[]) => void;
  addReply: (bvid: string, parentRpid: string, message: string) => void;

  // Chat
  sendMessage: (toUserId: string, content: string) => void;
  sendImageMessage: (toUserId: string, imageUri: string) => void;
  sendSharedFiles: (toUserId: string, files: FileRefV1[]) => boolean;
  sendVideoMessage: (toUserId: string, videoId: string, videoMeta?: { cover?: string; title?: string; author?: string }) => void;

  // Share
  shareVideo: (bvid: string) => void;

  // Dynamics
  publishDynamic: (text: string, images?: string[]) => void;

  // Danmaku
  sendDanmaku: (bvid: string, text: string, time?: number) => void;
  toggleDanmakuVisible: () => void;
}

// ---- Initial state ----

const initialState: BilibiliState = {
  ...BILIBILI_CONFIG,
  activeVideoId: null,
  settings: BILIBILI_CONFIG.settings,
  userComments: {},
  chats: (BILIBILI_CONFIG as any).chats || [],
  dynamics: [],
  danmaku: {},
  danmakuVisible: true,
};

// ---- Store ----

export const useBilibiliStore = createAppStoreWithActions<BilibiliState, BilibiliActions>(
  'bilibili',
  initialState,
  (set, get) => ({
    // ---- User ----
    updateUser: (updates) => {
      set((state) => ({
        user: { ...state.user, ...updates },
      }));
    },

    // ---- Active video ----
    setActiveVideoId: (id) => {
      set({ activeVideoId: id });
    },

    // ---- Settings ----
    setSetting: (path, value) => {
      set((state) => ({
        settings: deepSet(
          state.settings as unknown as Record<string, unknown>,
          path,
          value,
        ) as unknown as BilibiliSettings,
      }));
    },

    // ---- Follow ----
    toggleFollow: (id) => {
      const mid = String(id);
      set((state) => {
        const currentList = state.user.followingList || [];
        const isFollowing = currentList.some((u) => String(u.mid) === mid);

        let newList;

        if (isFollowing) {
          newList = currentList.filter((u) => String(u.mid) !== mid);
        } else {
          const newEntry = {
            mid,
            name: `用户${mid.slice(-4)}`,
            face: '',
            sign: '',
          };
          newList = [...currentList, newEntry];
        }

        return {
          user: {
            ...state.user,
            followingList: newList,
            following: newList.length,
          },
        };
      });
    },


    // ---- Interactions ----

    toggleLike: (vid) => {
      set((state) => {
        const liked = (state.user.likedVideoIds || []).includes(vid);
        const disliked = (state.user.dislikedVideoIds || []).includes(vid);

        let newLiked = [...(state.user.likedVideoIds || [])];
        let newDisliked = [...(state.user.dislikedVideoIds || [])];

        if (liked) {
          newLiked = newLiked.filter((id) => id !== vid);
        } else {
          newLiked.push(vid);
          if (disliked) newDisliked = newDisliked.filter((id) => id !== vid);
        }

        return {
          user: { ...state.user, likedVideoIds: newLiked, dislikedVideoIds: newDisliked },
        };
      });
    },

    toggleDislike: (vid) => {
      set((state) => {
        const liked = (state.user.likedVideoIds || []).includes(vid);
        const disliked = (state.user.dislikedVideoIds || []).includes(vid);

        let newLiked = [...(state.user.likedVideoIds || [])];
        let newDisliked = [...(state.user.dislikedVideoIds || [])];

        if (disliked) {
          newDisliked = newDisliked.filter((id) => id !== vid);
        } else {
          newDisliked.push(vid);
          if (liked) newLiked = newLiked.filter((id) => id !== vid);
        }

        return {
          user: { ...state.user, likedVideoIds: newLiked, dislikedVideoIds: newDisliked },
        };
      });
    },

    addCoin: (vid, count, alsoLike) => {
      const state = get();
      const existing = (state.user.coinedVideoCoins || {})[vid] || 0;

      if (existing + count > 2) {
        return { success: false, msg: '投硬币失败~超过投币上限啦~' };
      }
      if (state.user.coins < count) {
        return { success: false, msg: '硬币不足' };
      }

      set((s) => {
        const coinedVideoCoins = { ...(s.user.coinedVideoCoins || {}), [vid]: existing + count };
        const alreadyLiked = (s.user.likedVideoIds || []).includes(vid);
        return {
          user: {
            ...s.user,
            coins: s.user.coins - count,
            coinedVideoCoins,
            ...(alsoLike && !alreadyLiked ? {
              likedVideoIds: [...(s.user.likedVideoIds || []), vid],
              dislikedVideoIds: (s.user.dislikedVideoIds || []).filter(id => id !== vid),
            } : {}),
          },
        };
      });
      return { success: true, msg: '' };
    },

    toggleFav: (vid) => {
      set((state) => {
        const folders = state.user.favoritesFolders || [];
        const isFavored = folders.some(f => (f.videoIds || []).includes(vid));
        const updatedFolders = isFavored
          ? folders.map(f => ({
              ...f,
              videoIds: (f.videoIds || []).filter(id => id !== vid),
            }))
          : folders.map(f =>
              f.id === 'fav_default'
                ? { ...f, videoIds: [...(f.videoIds || []), vid] }
                : f,
            );

        return {
          user: { ...state.user, favoritesFolders: updatedFolders },
        };
      });
    },

    setFavFolders: (vid, selectedIds) => {
      set((state) => {
        const updatedFolders = (state.user.favoritesFolders || []).map((folder) => {
          const shouldContain = selectedIds.includes(folder.id);
          const currentIds = folder.videoIds || [];
          const alreadyIn = currentIds.includes(vid);
          if (shouldContain && !alreadyIn) {
            return { ...folder, videoIds: [...currentIds, vid] };
          }
          if (!shouldContain && alreadyIn) {
            return { ...folder, videoIds: currentIds.filter((id) => id !== vid) };
          }
          return folder;
        });
        return { user: { ...state.user, favoritesFolders: updatedFolders } };
      });
    },

    createFavFolder: (title, description, isPublic = true) => {
      const id = `fav_${simNow().toString(36)}`;
      set((state) => ({
        user: {
          ...state.user,
          favoritesFolders: [
            { id, title, isPublic, videoIds: [], ...(description ? { description } : {}) },
            ...(state.user.favoritesFolders || []),
          ],
        },
      }));
      return id;
    },

    tripleAction: (vid) => {
      let msg = '';
      const state = get();
      const liked = (state.user.likedVideoIds || []).includes(vid);
      const coinCount = (state.user.coinedVideoCoins || {})[vid] || 0;
      const isFavored = (state.user.favoritesFolders || []).some(
        (f) => (f.videoIds || []).includes(vid),
      );

      set((s) => {
        let newLiked = [...(s.user.likedVideoIds || [])];
        const newCoinedVideoCoins = { ...(s.user.coinedVideoCoins || {}) };
        let newCoins = s.user.coins;
        let newDisliked = (s.user.dislikedVideoIds || []).filter((id) => id !== vid);

        if (!liked) {
          newLiked.push(vid);
        }
        if (coinCount < 2) {
          if (s.user.coins >= 1) {
            newCoinedVideoCoins[vid] = coinCount + 1;
            newCoins -= 1;
          } else {
            msg = '硬币不足，仅点赞收藏';
          }
        }

        const updatedFolders = !isFavored
          ? (s.user.favoritesFolders || []).map((folder) => {
              if (folder.id === 'fav_default') {
                return { ...folder, videoIds: [...(folder.videoIds || []), vid] };
              }
              return folder;
            })
          : s.user.favoritesFolders;

        return {
          user: {
            ...s.user,
            likedVideoIds: newLiked,
            dislikedVideoIds: newDisliked,
            coinedVideoCoins: newCoinedVideoCoins,
            coins: newCoins,
            favoritesFolders: updatedFolders,
          },
        };
      });

      return { success: true, msg: msg || '三连成功' };
    },

    // ---- Anime/Drama ----
    toggleAnime: (id, title) => {
      set((state) => {
        const subscribed = (state.user.subscribedAnime || []).some((a) => a.id === id);
        return {
          user: {
            ...state.user,
            subscribedAnime: subscribed
              ? (state.user.subscribedAnime || []).filter((a) => a.id !== id)
              : [...(state.user.subscribedAnime || []), { id, title }],
          },
        };
      });
    },

    toggleDrama: (id, title) => {
      set((state) => {
        const subscribed = (state.user.subscribedDramas || []).some((d) => d.id === id);
        return {
          user: {
            ...state.user,
            subscribedDramas: subscribed
              ? (state.user.subscribedDramas || []).filter((d) => d.id !== id)
              : [...(state.user.subscribedDramas || []), { id, title }],
          },
        };
      });
    },

    // ---- Search history ----
    addSearchHistory: (keyword) => {
      const trimmed = keyword.trim();
      if (!trimmed) return;
      set((state) => {
        const history = state.user.searchHistory || [];
        const newHistory = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, 10);
        return {
          user: { ...state.user, searchHistory: newHistory },
        };
      });
    },

    clearSearchHistory: () => {
      set((state) => ({
        user: { ...state.user, searchHistory: [] },
      }));
    },

    // ---- Comments ----
    addComment: (bvid, message, images) => {
      const trimmed = message.trim();
      if (!trimmed && (!images || images.length === 0)) return;
      set((state) => {
        const s = state as BilibiliState;
        const user = s.user;
        const newComment: CommentReply = {
          rpid: `uc_${simNow()}`,
          mid: String(user.uid || user.name),
          uname: user.name,
          avatar: user.avatar,
          message: trimmed,
          like: 0,
          ctime: Math.floor(simNow() / 1000),
          location: '',
          replies: null,
          images,
        };
        const existing = s.userComments[bvid] || [];
        return {
          userComments: {
            ...s.userComments,
            [bvid]: [newComment, ...existing],
          },
        };
      });
    },

    // ---- Chat ----
    sendMessage: (toUserId, content) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      set((state) => {
        const s = state as BilibiliState;
        const nowTs = simNow();
        const newMessage: BilibiliChatMessage = {
          id: `msg_${nowTs}`,
          senderId: String(s.user.uid || s.user.name),
          content: trimmed,
          timestamp: nowTs,
          type: 'text',
        };
        return { chats: upsertChatMessages(s.chats, toUserId, s.user, s.settings.language, nowTs, [newMessage]) };
      });
    },

    sendImageMessage: (toUserId, imageUri) => {
      set((state) => {
        const s = state as BilibiliState;
        const nowTs = simNow();
        const stateStrings = resolveBilibiliStateStrings(s.settings.language);
        const newMessage: BilibiliChatMessage = {
          id: `msg_${nowTs}`,
          senderId: String(s.user.uid || s.user.name),
          content: stateStrings.chat_image_placeholder,
          timestamp: nowTs,
          type: 'image',
          image: imageUri,
        };
        return { chats: upsertChatMessages(s.chats, toUserId, s.user, s.settings.language, nowTs, [newMessage]) };
      });
    },

    sendSharedFiles: (toUserId, files) => {
      if (files.length === 0) return false;
      const s = get();
      const chat = s.chats.find((item) => item.userId === toUserId);
      const relation = [...(s.user.followingList ?? []), ...(s.user.followersList ?? [])]
        .find((item) => String(item.mid) === toUserId);
      // Do not recreate a conversation from a stale id after the asynchronous
      // attachment copy. The target must still be a chat or real relationship.
      if (!chat && !relation) return false;

      const nowTs = simNow();
      const messages: BilibiliChatMessage[] = files.map((file, index) => ({
        id: `msg_${nowTs}_${index}_${file.fileId}`,
        senderId: String(s.user.uid || s.user.name),
        content: file.name,
        timestamp: nowTs + index,
        type: file.mimeType.startsWith('image/') ? 'image' : 'file',
        fileRef: file,
      }));
      set({
        chats: upsertChatMessages(
          s.chats,
          toUserId,
          s.user,
          s.settings.language,
          nowTs,
          messages,
          relation ? { username: relation.name, avatar: relation.face } : undefined,
        ),
      });
      return true;
    },

    sendVideoMessage: (toUserId, videoId, videoMeta) => {
      set((state) => {
        const s = state as BilibiliState;
        const nowTs = simNow();
        const newMessage: BilibiliChatMessage = {
          id: `msg_${nowTs}`,
          senderId: String(s.user.uid || s.user.name),
          content: '[视频]',
          timestamp: nowTs,
          type: 'video',
          sharedVideoId: videoId,
          sharedVideoCover: videoMeta?.cover || '',
          sharedVideoTitle: videoMeta?.title || videoId,
          sharedVideoAuthor: videoMeta?.author || '',
        };
        return { chats: upsertChatMessages(s.chats, toUserId, s.user, s.settings.language, nowTs, [newMessage]) };
      });
    },

    shareVideo: (bvid) => {
      set((state) => {
        const s = state as BilibiliState;
        const shared = s.user.sharedVideoIds || [];
        if (shared.includes(bvid)) return {};
        return {
          user: { ...s.user, sharedVideoIds: [...shared, bvid] },
        };
      });
    },

    // ---- Dynamics ----
    publishDynamic: (text, images) => {
      const trimmed = text.trim();
      if (!trimmed && (!images || images.length === 0)) return;
      set((state) => {
        const s = state as BilibiliState;
        const id = `dyn_${simNow().toString(36)}`;
        const newDynamic: BilibiliDynamic = {
          id,
          authorId: String(s.user.uid || s.user.name),
          authorName: s.user.name,
          authorAvatar: s.user.avatar,
          text: trimmed,
          images: images && images.length > 0 ? images : undefined,
          timestamp: simNow(),
          likes: 0,
          comments: 0,
        };
        return { dynamics: [newDynamic, ...s.dynamics] };
      });
    },

    // ---- Danmaku ----
    sendDanmaku: (bvid, text, time) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      set((state) => {
        const s = state as BilibiliState;
        const id = `dm_${simNow().toString(36)}`;
        const newDm: BilibiliDanmaku = {
          id,
          bvid,
          text: trimmed,
          color: '#FFFFFF',
          time: time ?? 0,
          senderId: String(s.user.uid || s.user.name),
          senderName: s.user.name,
        };
        const existing = s.danmaku[bvid] || [];
        return {
          danmaku: {
            ...s.danmaku,
            [bvid]: [...existing, newDm],
          },
        };
      });
    },

    toggleDanmakuVisible: () => {
      set((state) => {
        const s = state as BilibiliState;
        return { danmakuVisible: !s.danmakuVisible };
      });
    },

    // ---- Comment Reply ----
    addReply: (bvid, parentRpid, message) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      set((state) => {
        const s = state as BilibiliState;
        const user = s.user;
        const newReply: CommentReply = {
          rpid: `ur_${simNow()}`,
          mid: String(user.uid || user.name),
          uname: user.name,
          avatar: user.avatar,
          message: trimmed,
          like: 0,
          ctime: Math.floor(simNow() / 1000),
          location: '',
          replies: null,
          parentRpid,
        };
        const existing = s.userComments[bvid] || [];
        return {
          userComments: {
            ...s.userComments,
            [bvid]: [newReply, ...existing],
          },
        };
      });
    },
  }),
  {
    partialize: (state) => {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(state)) {
        if (typeof v === 'function') continue;
        if (k === 'activeVideoId') continue;
        result[k] = v;
      }
      return result as Partial<BilibiliState>;
    },
  },
);

// ---- Memoized Selectors ----

type BilibiliStore = BilibiliState & BilibiliActions;

export const selectUser = (s: BilibiliStore) => s.user;

export const selectSearchHistory = memoSelector(
  (s: BilibiliStore) => s.user.searchHistory,
  (history) => history || [],
);
