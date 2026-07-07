import type { BilibiliUser, UserInfo } from '../types';
import { getAuthorsSync, getCommentersSync } from '../data/loader';

const DEFAULT_FALLBACK_NAME = 'B站用户';

/** 尝试从 authors 中查找 name/face（同步，接受外部传入或内部 fallback） */
function lookupAuthors(userId: string, authors?: Record<number, UserInfo> | null): UserInfo | undefined {
  if (!authors) {
    authors = getAuthorsSync();
  }
  if (!authors) return undefined;
  return authors[userId] || authors[Number(userId)];
}

/** 尝试从 commenters 中查找 name/face（同步，接受外部传入或内部 fallback） */
function lookupCommenters(userId: string, commenters?: Record<number, UserInfo> | null): UserInfo | undefined {
  if (!commenters) {
    commenters = getCommentersSync();
  }
  if (!commenters) return undefined;
  return commenters[userId] || commenters[Number(userId)];
}

/**
 * B站私信/转发界面展示昵称，不展示 UID。
 *
 * 解析优先级：
 *   1. 已有会话存储的 username（若不是 UID 形式）
 *   2. user.followingList
 *   3. user.followersList
 *   4. authors 数据（UP主信息）
 *   5. commenters 数据（评论区用户信息）
 *   6. fallback（默认 'B站用户'），不回退到原始 UID
 */
export function resolveBilibiliDisplayName(
  userId: string,
  user: Pick<BilibiliUser, 'followingList' | 'followersList'> | undefined | null,
  existingChatUsername?: string,
  fallback: string = DEFAULT_FALLBACK_NAME,
  authors?: Record<number, UserInfo> | null,
  commenters?: Record<number, UserInfo> | null,
): string {
  if (!userId) return fallback;

  // 1. 已有会话的 username —— 若不等于 userId（UID 透传场景）则直接使用
  if (existingChatUsername && existingChatUsername !== userId) {
    return existingChatUsername;
  }

  // 2. followingList
  const following = user?.followingList?.find(u => String(u.mid) === userId);
  if (following?.name) return following.name;

  // 3. followersList
  const follower = user?.followersList?.find(u => String(u.mid) === userId);
  if (follower?.name) return follower.name;

  // 4. authors 数据（UP主信息）
  const authorInfo = lookupAuthors(userId, authors);
  if (authorInfo?.name) return authorInfo.name;

  // 5. commenters 数据（评论区用户）
  const commenterInfo = lookupCommenters(userId, commenters);
  if (commenterInfo?.name) return commenterInfo.name;

  // 6. fallback —— 不展示完整 UID，取后4位缩写
  if (userId.length >= 4) return `用户${userId.slice(-4)}`;
  return fallback;
}

/**
 * 解析私信/转发界面展示的头像。优先级与 name 一致：
 *   1. 已有会话的 avatar
 *   2. user.followingList.face
 *   3. user.followersList.face
 *   4. authors 数据（UP主头像）
 *   5. commenters 数据（评论区用户头像）
 */
export function resolveBilibiliAvatar(
  userId: string,
  user: Pick<BilibiliUser, 'followingList' | 'followersList'> | undefined | null,
  existingChatAvatar?: string,
  authors?: Record<number, UserInfo> | null,
  commenters?: Record<number, UserInfo> | null,
): string {
  if (existingChatAvatar) return existingChatAvatar;
  const following = user?.followingList?.find(u => String(u.mid) === userId);
  if (following?.face) return following.face;
  const follower = user?.followersList?.find(u => String(u.mid) === userId);
  if (follower?.face) return follower.face;

  // authors 数据
  const authorInfo = lookupAuthors(userId, authors);
  if (authorInfo?.face) return authorInfo.face;

  // commenters 数据
  const commenterInfo = lookupCommenters(userId, commenters);
  if (commenterInfo?.face) return commenterInfo.face;

  return '';
}