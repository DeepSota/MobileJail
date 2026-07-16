import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWechatStore } from '@/apps/Wechat/state';
import { useAlipayStore } from '@/apps/Alipay/state';
import { useBilibiliStore } from '@/apps/Bilibili/state';
import { useRedBookStore } from '@/apps/RedBook/state';
import { strings as wechatStrings } from '@/apps/Wechat/res/strings';
import { strings as alipayStrings } from '@/apps/Alipay/res/strings';
import { strings as bilibiliStrings } from '@/apps/Bilibili/res/strings';
import { strings as redBookStrings } from '@/apps/RedBook/res/strings';
import type { FileRefV1 } from '@/os/types/fileShare';

const attachment: FileRefV1 = {
  version: 1,
  fileId: 'private-file',
  uri: 'content://simfs/files/private-file',
  name: '项目计划.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  modifiedAt: 1,
};

const originalWechat = {
  chats: structuredClone(useWechatStore.getState().chats),
  contacts: structuredClone(useWechatStore.getState().contacts),
};
const originalAlipay = {
  conversations: structuredClone(useAlipayStore.getState().conversations),
  contacts: structuredClone(useAlipayStore.getState().contacts),
  chatHistory: structuredClone(useAlipayStore.getState().chatHistory),
};
const originalBilibili = {
  chats: structuredClone(useBilibiliStore.getState().chats),
  user: structuredClone(useBilibiliStore.getState().user),
};
const originalRedBook = {
  chats: structuredClone(useRedBookStore.getState().chats),
  users: structuredClone(useRedBookStore.getState().users),
  user: structuredClone(useRedBookStore.getState().user),
};

describe('social file-share atomic recipient commits', () => {
  beforeEach(() => {
    useWechatStore.setState({
      chats: structuredClone(originalWechat.chats),
      contacts: structuredClone(originalWechat.contacts),
    });
    useAlipayStore.setState({
      conversations: structuredClone(originalAlipay.conversations),
      contacts: structuredClone(originalAlipay.contacts),
      chatHistory: structuredClone(originalAlipay.chatHistory),
    });
    useBilibiliStore.setState({
      chats: structuredClone(originalBilibili.chats),
      user: structuredClone(originalBilibili.user),
    });
    useRedBookStore.setState({
      chats: structuredClone(originalRedBook.chats),
      users: structuredClone(originalRedBook.users),
      user: structuredClone(originalRedBook.user),
    });
  });

  afterEach(() => {
    useWechatStore.setState({
      chats: structuredClone(originalWechat.chats),
      contacts: structuredClone(originalWechat.contacts),
    });
    useAlipayStore.setState({
      conversations: structuredClone(originalAlipay.conversations),
      contacts: structuredClone(originalAlipay.contacts),
      chatHistory: structuredClone(originalAlipay.chatHistory),
    });
    useBilibiliStore.setState({
      chats: structuredClone(originalBilibili.chats),
      user: structuredClone(originalBilibili.user),
    });
    useRedBookStore.setState({
      chats: structuredClone(originalRedBook.chats),
      users: structuredClone(originalRedBook.users),
      user: structuredClone(originalRedBook.user),
    });
  });

  it('Wechat rejects a removed target and commits to a current contact', () => {
    const contact = originalWechat.contacts.find(
      (item) => item.wxid !== useWechatStore.getState().user.wxid && !item.isBlacklisted,
    );
    expect(contact).toBeDefined();
    useWechatStore.setState({ chats: [], contacts: contact ? [contact] : [] });

    expect(useWechatStore.getState().sendSharedAttachments('removed-contact', [attachment])).toBe(false);
    expect(useWechatStore.getState().chats).toHaveLength(0);

    expect(useWechatStore.getState().sendSharedAttachments(contact!.wxid, [attachment])).toBe(true);
    expect(useWechatStore.getState().chats[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileRef: attachment }),
    ]));
  });

  it('Wechat commits a multi-recipient share all at once or not at all', () => {
    const contacts = originalWechat.contacts.filter(
      (item) => item.wxid !== useWechatStore.getState().user.wxid && !item.isBlacklisted,
    ).slice(0, 2);
    expect(contacts).toHaveLength(2);
    useWechatStore.setState({ chats: [], contacts: structuredClone(contacts) });

    expect(useWechatStore.getState().sendSharedAttachmentsToTargets(
      [contacts[0].wxid, 'removed-contact'],
      [attachment],
    )).toBe(false);
    expect(useWechatStore.getState().chats).toHaveLength(0);

    expect(useWechatStore.getState().sendSharedAttachmentsToTargets(
      contacts.map((contact) => contact.wxid),
      [attachment],
    )).toBe(true);
    expect(useWechatStore.getState().chats).toHaveLength(2);
    expect(useWechatStore.getState().chats.every((chat) => (
      chat.messages.some((message) => message.fileRef?.fileId === attachment.fileId)
    ))).toBe(true);
  });

  it('Alipay never creates an unknown conversation from a stale id', () => {
    const contact = originalAlipay.contacts[0];
    expect(contact).toBeDefined();
    useAlipayStore.setState({ conversations: [], contacts: contact ? [contact] : [], chatHistory: {} });

    expect(useAlipayStore.getState().sendSharedFiles('conv_p_removed', [attachment])).toBe(false);
    expect(useAlipayStore.getState().conversations).toHaveLength(0);

    const conversationId = `conv_p_${contact!.id}`;
    expect(useAlipayStore.getState().sendSharedFiles(conversationId, [attachment])).toBe(true);
    expect(useAlipayStore.getState().chatHistory[conversationId]).toEqual([
      expect.objectContaining({ fileRef: attachment }),
    ]);
  });

  it('Bilibili requires a current chat or relationship at commit time', () => {
    const relation = originalBilibili.user.followingList?.[0]
      ?? originalBilibili.user.followersList?.[0];
    expect(relation).toBeDefined();
    useBilibiliStore.setState({
      chats: [],
      user: {
        ...structuredClone(originalBilibili.user),
        followingList: relation ? [relation] : [],
        followersList: [],
      },
    });

    expect(useBilibiliStore.getState().sendSharedFiles('removed-user', [attachment])).toBe(false);
    expect(useBilibiliStore.getState().chats).toHaveLength(0);

    const userId = String(relation!.mid);
    expect(useBilibiliStore.getState().sendSharedFiles(userId, [attachment])).toBe(true);
    expect(useBilibiliStore.getState().chats[0]).toEqual(expect.objectContaining({
      userId,
      messages: expect.arrayContaining([expect.objectContaining({ fileRef: attachment })]),
    }));
  });

  it('RedBook creates a new DM only for a followed real user', () => {
    const followedUser = { id: 'followed-real-user', name: '真实关注用户', avatar: '/avatar.png' };
    useRedBookStore.setState({
      chats: [],
      users: { [followedUser.id]: followedUser },
      user: { ...structuredClone(originalRedBook.user), followingIds: [followedUser.id] },
    });

    expect(useRedBookStore.getState().sendSharedFiles('removed-user', [attachment])).toBe(false);
    expect(useRedBookStore.getState().chats).toHaveLength(0);

    expect(useRedBookStore.getState().sendSharedFiles(followedUser.id, [attachment])).toBe(true);
    expect(useRedBookStore.getState().chats[0]).toEqual(expect.objectContaining({
      userId: followedUser.id,
      username: followedUser.name,
      messages: [expect.objectContaining({ fileRef: attachment })],
    }));
  });
});

describe('social share pages roll back before reporting recipient races', () => {
  const pages = [
    'apps/Wechat/pages/share/ShareForwardPage.tsx',
    'apps/Alipay/pages/ShareFilePage.tsx',
    'apps/Bilibili/pages/ShareFilePage.tsx',
    'apps/RedBook/pages/ShareFilePage.tsx',
  ];

  it.each(pages)('%s uses the shared private-attachment rollback', (path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('rollbackPrivateAttachments');
    expect(source.indexOf('rollbackPrivateAttachments')).toBeLessThan(source.lastIndexOf("go('share."));
  });

  it('keeps every share page in place when the final recipient commit is rejected', () => {
    const wechat = readFileSync('apps/Wechat/pages/share/ShareForwardPage.tsx', 'utf8');
    expect(wechat.indexOf('if (!attachmentCommitted)')).toBeLessThan(
      wechat.indexOf("go('share.forward.send.toChat'"),
    );

    for (const path of pages.slice(1)) {
      const source = readFileSync(path, 'utf8');
      expect(source.indexOf('if (!sendSharedFiles'), path).toBeLessThan(
        source.indexOf("go('share.file.send'"),
      );
    }
  });

  it('exposes localized recipient-unavailable feedback in all four Apps', () => {
    expect(wechatStrings.share_recipient_unavailable).toContain('文件未发送');
    expect(alipayStrings.file_share_recipient_unavailable).toContain('文件未发送');
    expect(bilibiliStrings.file_share_recipient_unavailable).toContain('文件未发送');
    expect(redBookStrings.file_share_recipient_unavailable).toContain('文件未发送');
  });

  it('keeps a visible missing-image placeholder and reports failed opens in every chat', () => {
    const chatPages = [
      'apps/Wechat/pages/chat/ChatDetail.tsx',
      'apps/Alipay/pages/ChatPage.tsx',
      'apps/Bilibili/pages/ChatPage.tsx',
      'apps/RedBook/pages/ChatPage.tsx',
    ];
    for (const path of chatPages) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toContain('file_attachment_unavailable');
      expect(source, path).toContain('role="status"');
      expect(source, path).toMatch(/if \(!opened\).*AttachmentUnavailable|if \(!openFileRefInViewer/);
    }
  });

  it('localizes the historical-attachment missing state in every App', () => {
    expect(wechatStrings.file_attachment_unavailable).toContain('无法打开');
    expect(alipayStrings.file_attachment_unavailable).toContain('无法打开');
    expect(bilibiliStrings.file_attachment_unavailable).toContain('无法打开');
    expect(redBookStrings.file_attachment_unavailable).toContain('无法打开');
  });

  it('builds RedBook recipients from real followed users as well as chats', () => {
    const source = readFileSync('apps/RedBook/pages/ShareFilePage.tsx', 'utf8');
    expect(source).toContain('getRedBookFollowingIds(user)');
    expect(source).toContain('resolveRedBookRuntimeUser(runtimeUsers, base.usersById, user, userId)');
    expect(source).toContain('recipients.map');
  });
});
