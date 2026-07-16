import { createAppStoreWithActions, memoSelector, registerStateAdapter } from '../../os/createAppStore';
import { fromTimestamp, now as timeNow } from '../../os/TimeService';
import {
  X_CONFIG,
  currentUser,
  trends,
  defaultFollowedUserIds,
  defaultFollowerUserIds,
} from './data';
import { loadReplies, preload } from './data/loader';
import type { XUser, XPost, XConversation, XSettings } from './types';
import { getJustNowLabel } from './utils/formatTime';
import type { XRuntimePostTable } from './utils/runtimePostResolver';
import type { FileRefV1 } from '@/os/types/fileShare';

// ---- Helpers ----
// 所有 id (user / post) 在 base 数据里都已规范化, case-sensitive 唯一。
// 运行时写入 (toggleFollow / toggleLike 等) 直接用上游传入的 id, 不做任何归一。
// user 没有 handle 字段, 组件显示 @xxx 时一律 `@${user.id}` 拼接。

const stripDerivedUserCounts = (user: Record<string, any>): Record<string, any> => {
  const { following: _following, followers: _followers, ...rest } = user;
  return rest;
};

// ---- Types ----

export type XMeUser = XUser & {
  postIds: string[];
  replyIds: string[];
  followedUserIds: string[];
  followerUserIds: string[];
  likedPostIds: string[];
  retweetedPostIds: string[];
  bookmarkedPostIds: string[];
};

export interface XState {
  // Persisted store state
  user: XMeUser;
  posts: XRuntimePostTable;
  conversations: XConversation[];
  settings: XSettings;

  // Ephemeral state (excluded from persistence via partialize)
  currentSearchQuery: string;
  pendingQuotedPostId: string | null;
}

export interface XActions {
  toggleLike: (postId: string) => void;
  toggleRetweet: (postId: string) => void;
  toggleBookmark: (postId: string) => void;
  toggleFollow: (userId: string) => void;

  updateSettings: (patch: Partial<XSettings>) => void;
  setSearchQuery: (q: string) => void;
  setPendingQuotedPostId: (id: string | null) => void;

  addPost: (content: string, images?: string[], quotedPostId?: string) => void;
  addReply: (postId: string, content: string, images?: string[]) => void;
  sendMessage: (conversationId: string, content: string) => void;
  sendImageMessage: (conversationId: string, imageUri: string) => void;
  /** Atomically append shared files only while the selected conversation still exists. */
  sendSharedFiles: (conversationId: string, files: FileRefV1[]) => boolean;
  /** Commit to an existing conversation or atomically create a DM for a followed user. */
  sendSharedFilesToRecipient: (input: {
    participantId: string;
    expectedConversationId?: string;
    files: FileRefV1[];
  }) => string | null;
  sendPostMessage: (conversationId: string, postId: string) => void;
  /** 按 participantId 查找现有对话, 不存在则创建一个新的空对话, 返回 conversationId。 */
  ensureConversationForUser: (userId: string) => string;

  updateUser: (patch: Partial<XUser>) => void;

  /** Lazy load replies.json (huge); loader 内部 in-flight 去重。 */
  ensureRepliesLoaded: () => Promise<void>;
  _loadData: () => void;
}

// ---- Initial state ----

const initialState: XState = {
  user: {
    ...(stripDerivedUserCounts(currentUser) as XUser),
    postIds: currentUser.postIds ?? [],
    replyIds: currentUser.replyIds ?? [],
    followedUserIds: defaultFollowedUserIds,
    followerUserIds: defaultFollowerUserIds,
    likedPostIds: currentUser.likedPostIds ?? [],
    retweetedPostIds: currentUser.retweetedPostIds ?? [],
    bookmarkedPostIds: currentUser.bookmarkedPostIds ?? [],
  },
  posts: (X_CONFIG as any).posts ?? {},
  conversations: X_CONFIG.conversations ?? [],
  settings: X_CONFIG.settings,

  currentSearchQuery: '',
  pendingQuotedPostId: null,
};

// ---- Store ----

const toggleInArray = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

export const useXStore = createAppStoreWithActions<XState, XActions>(
  'x',
  initialState,
  (set, get) => ({
    toggleLike: (postId) => set((s) => ({
      user: { ...s.user, likedPostIds: toggleInArray(s.user.likedPostIds, postId) },
    })),
    toggleRetweet: (postId) => set((s) => ({
      user: { ...s.user, retweetedPostIds: toggleInArray(s.user.retweetedPostIds, postId) },
    })),
    toggleBookmark: (postId) => set((s) => ({
      user: { ...s.user, bookmarkedPostIds: toggleInArray(s.user.bookmarkedPostIds, postId) },
    })),
    toggleFollow: (userId) => set((s) => ({
      user: { ...s.user, followedUserIds: toggleInArray(s.user.followedUserIds, userId) },
    })),

    updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    setSearchQuery: (q) => set({ currentSearchQuery: q }),
    setPendingQuotedPostId: (id) => set({ pendingQuotedPostId: id }),

    addPost: (content, images, quotedPostId) => {
      // 调用方未传 quotedPostId 时回退到 pendingQuotedPostId, 保证"引用"入口拼出引用关系。
      const effectiveQuotedPostId = quotedPostId ?? get().pendingQuotedPostId ?? undefined;
      const createdAt = timeNow();
      const newPost: XPost = {
        id: `new_${createdAt}`,
        authorId: currentUser.id,
        content,
        createdAt: fromTimestamp(createdAt).toISOString(),
        images,
        time: getJustNowLabel(),
        stats: { comments: 0, retweets: 0, likes: 0, views: 0 },
        quotedPostId: effectiveQuotedPostId,
      };
      // 把新 post 放到 runtime posts 表头部, 使 Object.entries 迭代时它最先出现,
      // 从而在 mergeLocalPosts → resolveXRuntimePosts 输出里排在 timeline 最顶。
      set((s) => {
        const { [newPost.id]: _existing, ...restPosts } = s.posts;
        return {
          posts: { [newPost.id]: newPost, ...restPosts },
          user: { ...s.user, postIds: [newPost.id, ...s.user.postIds] },
          pendingQuotedPostId: null,
        };
      });
    },

    addReply: (postId, content, images) => {
      const reply: XPost = {
        id: `reply_${timeNow()}`,
        authorId: currentUser.id,
        content,
        createdAt: fromTimestamp(timeNow()).toISOString(),
        time: getJustNowLabel(),
        stats: { comments: 0, retweets: 0, likes: 0, views: 0 },
        threadId: postId,
        images,
      };
      set((s) => ({
        posts: { ...s.posts, [reply.id]: reply },
        user: { ...s.user, replyIds: [reply.id, ...s.user.replyIds] },
      }));
    },

    sendMessage: (conversationId, content) => {
      set((s) => ({
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv;
          const newMessage = {
            id: `msg_${timeNow()}`,
            senderId: currentUser.id,
            receiverId: conv.participantId,
            content,
            time: getJustNowLabel(),
            read: true,
          };
          return { ...conv, messages: [...conv.messages, newMessage], lastMessageId: newMessage.id };
        }),
      }));
    },

    sendImageMessage: (conversationId, imageUri) => {
      set((s) => ({
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv;
          const newMessage = {
            id: `msg_${timeNow()}`,
            senderId: currentUser.id,
            receiverId: conv.participantId,
            content: '[图片]',
            time: getJustNowLabel(),
            read: true,
            type: 'image' as const,
            image: imageUri,
          };
          return { ...conv, messages: [...conv.messages, newMessage], lastMessageId: newMessage.id };
        }),
      }));
    },

    sendSharedFiles: (conversationId, files) => {
      if (files.length === 0) return false;
      const state = get();
      const conversationIndex = state.conversations.findIndex((conversation) => conversation.id === conversationId);
      if (conversationIndex < 0) return false;

      const conversation = state.conversations[conversationIndex];
      const createdAt = timeNow();
      const messageTime = getJustNowLabel();
      const messages = files.map((file, index) => ({
        id: `msg_${createdAt}_${index}_${file.fileId}`,
        senderId: currentUser.id,
        receiverId: conversation.participantId,
        content: file.name,
        time: messageTime,
        read: true,
        type: (file.mimeType.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
        fileRef: file,
      }));
      const conversations = [...state.conversations];
      conversations[conversationIndex] = {
        ...conversation,
        messages: [...conversation.messages, ...messages],
        lastMessageId: messages[messages.length - 1].id,
      };
      set({ conversations });
      return true;
    },

    sendSharedFilesToRecipient: ({ participantId, expectedConversationId, files }) => {
      if (!participantId || files.length === 0) return null;
      const state = get();
      let conversation = expectedConversationId
        ? state.conversations.find((item) => item.id === expectedConversationId && item.participantId === participantId)
        : state.conversations.find((item) => item.participantId === participantId);

      // Existing-conversation picks must not silently retarget after a race.
      if (expectedConversationId && !conversation) return null;
      // A new DM is permitted only while the relationship still exists.
      if (!conversation && !state.user.followedUserIds.includes(participantId)) return null;

      if (!conversation) {
        conversation = {
          id: `conv_${participantId}_${timeNow()}`,
          participantId,
          lastMessageId: '',
          unreadCount: 0,
          messages: [],
        };
      }
      const createdAt = timeNow();
      const messageTime = getJustNowLabel();
      const messages = files.map((file, index) => ({
        id: `msg_${createdAt}_${index}_${file.fileId}`,
        senderId: currentUser.id,
        receiverId: participantId,
        content: file.name,
        time: messageTime,
        read: true,
        type: (file.mimeType.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
        fileRef: file,
      }));
      const committed = {
        ...conversation,
        messages: [...conversation.messages, ...messages],
        lastMessageId: messages[messages.length - 1].id,
      };
      const existingIndex = state.conversations.findIndex((item) => item.id === conversation!.id);
      const conversations = [...state.conversations];
      if (existingIndex >= 0) conversations[existingIndex] = committed;
      else conversations.unshift(committed);
      set({ conversations });
      return committed.id;
    },

    sendPostMessage: (conversationId, postId) => {
      set((s) => ({
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv;
          const newMessage = {
            id: `msg_${timeNow()}`,
            senderId: currentUser.id,
            receiverId: conv.participantId,
            content: '[帖子]',
            time: getJustNowLabel(),
            read: true,
            type: 'post' as const,
            forwardedPostId: postId,
          };
          return { ...conv, messages: [...conv.messages, newMessage], lastMessageId: newMessage.id };
        }),
      }));
    },

    updateUser: (patch) => set((s) => ({
      user: { ...s.user, ...patch },
    })),

    ensureConversationForUser: (userId) => {
      // 已有对话: 直接返回 id, 不重复创建。
      const existing = get().conversations.find((c) => c.participantId === userId);
      if (existing) return existing.id;

      const newConv: XConversation = {
        id: `conv_${userId}_${timeNow()}`,
        participantId: userId,
        lastMessageId: '',
        unreadCount: 0,
        messages: [],
      };
      set((s) => ({ conversations: [newConv, ...s.conversations] }));
      return newConv.id;
    },

    ensureRepliesLoaded: async () => {
      await loadReplies();
    },

    _loadData: () => {
      void preload();
    },
  }),
  {
    // 显式 allowlist: 只持久化用户运行态。新增字段默认不进 localStorage,
    // 避免无意把 ephemeral / 信号位 / base cache 写盘。
    partialize: (state) => ({
      user: stripDerivedUserCounts(state.user) as XMeUser,
      posts: state.posts,
      conversations: state.conversations,
      settings: state.settings,
    }),
  },
);

export type XStore = XState & XActions;

// ---- Pure-runtime selectors (不依赖 base dataset; base-依赖 view 在 data/view.ts) ----

export const selectUser = memoSelector(
  (s: XStore) => s.user,
  (user) => ({
    ...user,
    following: user.followedUserIds.length,
    followers: user.followerUserIds.length,
  }),
);

export const selectEffectiveFollowedSet = memoSelector(
  (s: XStore) => s.user.followedUserIds,
  (ids) => new Set(ids),
);

/** Trends 是 static, 不需要 selector wrapper, 直接用 import 即可。保留为 hook-like 兼容。 */
export const selectTrends = () => trends;

// ---- State adapter for bench_env ----
// 剥离 ephemeral 字段, 让 bench 看到的 state 等同于 partialize 持久化 schema。
registerStateAdapter('x', (raw: any) => {
  const {
    currentSearchQuery: _currentSearchQuery,
    pendingQuotedPostId: _pendingQuotedPostId,
    ...runtime
  } = raw;
  return {
    ...runtime,
    user: runtime.user ? stripDerivedUserCounts(runtime.user) : runtime.user,
  };
});
