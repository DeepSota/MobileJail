import { useSyncExternalStore } from 'react';
import { createAppStoreWithActions } from '../../os/createAppStore';
import { SMS_CONFIG } from './data';
import ContentResolver from '../../os/ContentResolver';
import { ensureSmsProviderRegistered } from '../../os/providers/SmsProvider';
import * as TimeService from '../../os/TimeService';
import { NotificationService } from '../../os/NotificationService';
import type { Conversation, Message } from './types';
import type { FileRefV1 } from '../../os/types/fileShare';
import { isValidSmsPhoneNumber, normalizeSmsPhoneNumber } from './utils/phoneNumber';

// --- Helper functions ---

type MessagesByConversationId = Record<string, Message[]>;

const randomId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${TimeService.now().toString(36).slice(-4)}`;

// --- State & Actions interfaces ---

interface SmsState {
  settings: Record<string, boolean>;
  _temp: {
    pendingTimers: number[];
    pendingNewMessageFiles: FileRefV1[];
  };
}

interface SmsActions {
  updateSettings: (patch: Record<string, boolean>) => void;
  trackTimer: (timerId: number) => void;
  untrackTimer: (timerId: number) => void;
  clearTimers: () => void;
  setPendingNewMessageFiles: (files: FileRefV1[]) => void;
  consumePendingNewMessageFiles: () => FileRefV1[];
}

// --- Initial state ---

const initialState: SmsState = {
  settings: { ...SMS_CONFIG.settings },
  _temp: { pendingTimers: [], pendingNewMessageFiles: [] },
};

// --- Store ---

export const useSmsStore = createAppStoreWithActions<SmsState, SmsActions>(
  'sms',
  initialState,
  (set, get) => ({
    updateSettings(patch: Record<string, boolean>) {
      set(state => ({ settings: { ...state.settings, ...patch } }));
    },
    trackTimer(timerId: number) {
      set((state) => ({ _temp: { ...state._temp, pendingTimers: [...state._temp.pendingTimers, timerId] } }));
    },
    untrackTimer(timerId: number) {
      set((state) => ({
        _temp: { ...state._temp, pendingTimers: state._temp.pendingTimers.filter((id) => id !== timerId) },
      }));
    },
    clearTimers() {
      const { pendingTimers } = get()._temp;
      pendingTimers.forEach((timerId) => window.clearTimeout(timerId));
      set((state) => ({ _temp: { ...state._temp, pendingTimers: [] } }));
    },
    setPendingNewMessageFiles(files: FileRefV1[]) {
      set((state) => ({ _temp: { ...state._temp, pendingNewMessageFiles: files } }));
    },
    consumePendingNewMessageFiles(): FileRefV1[] {
      const files = get()._temp.pendingNewMessageFiles;
      set((state) => ({ _temp: { ...state._temp, pendingNewMessageFiles: [] } }));
      return files;
    },
  }),
  {
    partialize: (state) => {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(state)) {
        if (typeof v !== 'function' && k !== '_temp') result[k] = v;
      }
      return result as Partial<SmsState>;
    },
  },
);

function buildSmsSnapshot(): { conversations: Conversation[]; messagesByConversationId: MessagesByConversationId } {
  ensureSmsProviderRegistered();
  const conversations = ContentResolver.query<Conversation>('content://sms/conversations').items;
  const messagesByConversationId: MessagesByConversationId = {};
  conversations.forEach((conversation) => {
    messagesByConversationId[conversation.id] = ContentResolver.query<Message>(
      `content://sms/messages?conversationId=${conversation.id}`,
    ).items;
  });
  return { conversations, messagesByConversationId };
}

function getEmptySmsSnapshot(): { conversations: Conversation[]; messagesByConversationId: MessagesByConversationId } {
  return { conversations: [], messagesByConversationId: {} };
}

let _smsSnapshot: { conversations: Conversation[]; messagesByConversationId: MessagesByConversationId } | null = null;

function ensureSmsSnapshot(): { conversations: Conversation[]; messagesByConversationId: MessagesByConversationId } {
  if (_smsSnapshot) return _smsSnapshot;
  _smsSnapshot = buildSmsSnapshot();
  return _smsSnapshot;
}

function subscribeSms(listener: () => void): () => void {
  return ContentResolver.registerContentObserver('content://sms', () => {
    _smsSnapshot = buildSmsSnapshot();
    listener();
  });
}

function getSmsSnapshot() {
  return ensureSmsSnapshot();
}

export function useSmsProviderState(): { conversations: Conversation[]; messagesByConversationId: MessagesByConversationId } {
  return useSyncExternalStore(subscribeSms, getSmsSnapshot, getEmptySmsSnapshot);
}

/** Check whether a string looks like a valid phone number.
 * Accepts 3+ digits to cover short codes (110/120 emergency, 10086/12306/95588 service numbers). */
export function isValidPhoneNumber(value: string): boolean {
  return isValidSmsPhoneNumber(value);
}

export function ensureConversation(recipient: string, phoneNumber?: string): string {
  const normalized = recipient.trim();
  if (!normalized) return '';
  const normalizedPhone = normalizeSmsPhoneNumber(phoneNumber);
  // A phone number is the SMS identity.  Never reuse a same-name thread for a
  // different number (two contacts may legitimately share a display name).
  const existing = normalizedPhone
    ? ContentResolver.query<Conversation>(
        `content://sms/conversations?phoneNumber=${encodeURIComponent(normalizedPhone)}`,
      ).items[0]
    : ContentResolver.query<Conversation>(
        `content://sms/conversations?sender=${encodeURIComponent(normalized)}`,
      ).items[0];
  if (existing) return existing.id;
  const uri = ContentResolver.insert('content://sms/conversations', {
    sender: normalized,
    ...(normalizedPhone ? { phoneNumber: normalizedPhone } : {}),
  });
  return String(uri.split('/').pop() ?? '');
}

export function markConversationRead(conversationId: string): void {
  ContentResolver.update(`content://sms/conversations/${conversationId}`, { isUnread: false });
  NotificationService.dismissByRoute('sms', `/conversation/${conversationId}`);
}

export function markConversationUnread(conversationId: string): void {
  ContentResolver.update(`content://sms/conversations/${conversationId}`, { isUnread: true });
}

export function deleteConversation(conversationId: string): void {
  ContentResolver.delete(`content://sms/conversations/${conversationId}`);
  NotificationService.dismissByRoute('sms', `/conversation/${conversationId}`);
}

export function pinConversation(conversationId: string, pinned: boolean): void {
  ContentResolver.update(`content://sms/conversations/${conversationId}`, { isPinned: pinned });
}

export function markAllRead(): number {
  const conversations = ContentResolver.query<Conversation>('content://sms/conversations').items;
  const changed = conversations.filter((conversation) => conversation.isUnread).length;
  conversations.forEach((conversation) => {
    if (conversation.isUnread) {
      ContentResolver.update(`content://sms/conversations/${conversation.id}`, { isUnread: false });
    }
  });
  if (changed > 0) NotificationService.clearForApp('sms');
  return changed;
}

export function sendMessage(conversationId: string, content: string): void {
  const trimmed = content.trim();
  if (!conversationId || !trimmed) return;

  const messageUri = ContentResolver.insert(
    `content://sms/messages?conversationId=${encodeURIComponent(conversationId)}`,
    {
      id: randomId('msg'),
      type: 'text',
      content: trimmed,
      timestamp: TimeService.formatTime(),
      isOutgoing: true,
      status: 'sending',
    },
  );

  const conversation = ContentResolver.query<Conversation>(`content://sms/conversations/${conversationId}`).items[0];
  if (conversation) {
    window.dispatchEvent(new CustomEvent('sms-outgoing', {
      detail: { to: conversation.sender, content: trimmed },
    }));
  }

  const timerId = window.setTimeout(() => {
    ContentResolver.update(messageUri, { status: 'sent' });
    useSmsStore.getState().untrackTimer(timerId);
  }, 300);
  useSmsStore.getState().trackTimer(timerId);
}

export function sendImage(conversationId: string, imagePath: string): void {
  if (!conversationId || !imagePath) return;

  ContentResolver.insert(
    `content://sms/messages?conversationId=${encodeURIComponent(conversationId)}`,
    {
      id: randomId('img'),
      type: 'image',
      content: imagePath,
      timestamp: TimeService.formatTime(),
      isOutgoing: true,
      status: 'sent',
      mimeType: 'image/jpeg',
    },
  );
}

export function sendFile(conversationId: string, file: { path: string; name: string; size: number; mimeType: string }): void {
  if (!conversationId || !file.path) return;

  ContentResolver.insert(
    `content://sms/messages?conversationId=${encodeURIComponent(conversationId)}`,
    {
      id: randomId('file'),
      type: 'file',
      content: file.path,
      timestamp: TimeService.formatTime(),
      isOutgoing: true,
      status: 'sent',
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.mimeType,
    },
  );
}

/** Persist already-cloned, App-owned attachments in an SMS/RCS conversation. */
export function sendSharedAttachments(conversationId: string, files: FileRefV1[]): void {
  if (!conversationId) return;
  for (const file of files) {
    if (!file?.fileId || !file?.uri) continue;
    const isImage = file.mimeType.startsWith('image/');
    ContentResolver.insert(
      `content://sms/messages?conversationId=${encodeURIComponent(conversationId)}`,
      {
        id: randomId(isImage ? 'img' : 'file'),
        type: isImage ? 'image' : 'file',
        content: file.uri,
        timestamp: TimeService.formatTime(),
        isOutgoing: true,
        status: 'sent',
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.mimeType,
        fileRef: file,
      },
    );
  }
}

/**
 * Atomically persist a recipient thread and every outgoing attachment/text
 * row. Provider writes are synchronous, so any later failure can remove the
 * rows already inserted before the caller rolls back the private file copies.
 */
export function commitOutgoingShare(input: {
  recipients: Array<{ displayName: string; phoneNumber: string }>;
  files: readonly FileRefV1[];
  text?: string;
}): string {
  ensureSmsProviderRegistered();
  const normalizedRecipients = input.recipients.flatMap((recipient) => {
    const phoneNumber = normalizeSmsPhoneNumber(recipient.phoneNumber);
    if (!phoneNumber) return [];
    return [{ displayName: recipient.displayName.trim() || phoneNumber, phoneNumber }];
  }).filter((recipient, index, list) => (
    list.findIndex((candidate) => candidate.phoneNumber === recipient.phoneNumber) === index
  ));
  if (normalizedRecipients.length === 0) throw new Error('[SMS] Invalid recipient');
  const phoneNumbers = normalizedRecipients.map((recipient) => recipient.phoneNumber).sort();
  const existing = ContentResolver.query<Conversation>('content://sms/conversations').items.find((conversation) => {
    if (phoneNumbers.length === 1) {
      return normalizeSmsPhoneNumber(conversation.phoneNumber) === phoneNumbers[0];
    }
    const current = [...(conversation.phoneNumbers ?? [])].sort();
    return current.length === phoneNumbers.length
      && current.every((phone, index) => phone === phoneNumbers[index]);
  });
  let conversationId = existing?.id ?? '';
  let createdConversation = false;
  const insertedMessageUris: string[] = [];

  try {
    if (!conversationId) {
      const uri = ContentResolver.insert('content://sms/conversations', {
        sender: normalizedRecipients.map((recipient) => recipient.displayName).join('、'),
        ...(normalizedRecipients.length === 1
          ? { phoneNumber: normalizedRecipients[0].phoneNumber }
          : {
              phoneNumbers: normalizedRecipients.map((recipient) => recipient.phoneNumber),
              participantNames: normalizedRecipients.map((recipient) => recipient.displayName),
            }),
      });
      conversationId = String(uri.split('/').pop() ?? '');
      if (!conversationId) throw new Error('[SMS] Conversation insert failed');
      createdConversation = true;
    }

    for (const file of input.files) {
      if (!file?.fileId || !file?.uri) throw new Error('[SMS] Invalid attachment');
      const isImage = file.mimeType.startsWith('image/');
      const uri = ContentResolver.insert(
        `content://sms/messages?conversationId=${encodeURIComponent(conversationId)}`,
        {
          id: randomId(isImage ? 'img' : 'file'),
          type: isImage ? 'image' : 'file',
          content: file.uri,
          timestamp: TimeService.formatTime(),
          isOutgoing: true,
          status: 'sent',
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.mimeType,
          fileRef: file,
        },
      );
      insertedMessageUris.push(uri);
    }

    const text = input.text?.trim() ?? '';
    if (text) {
      const uri = ContentResolver.insert(
        `content://sms/messages?conversationId=${encodeURIComponent(conversationId)}`,
        {
          id: randomId('msg'),
          type: 'text',
          content: text,
          timestamp: TimeService.formatTime(),
          isOutgoing: true,
          status: 'sent',
        },
      );
      insertedMessageUris.push(uri);
    }

    if (text && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sms-outgoing', {
        detail: { to: normalizedRecipients.map((recipient) => recipient.phoneNumber), content: text },
      }));
    }
    return conversationId;
  } catch (error) {
    for (const uri of insertedMessageUris.reverse()) {
      try { ContentResolver.delete(uri); } catch { /* preserve original error */ }
    }
    if (createdConversation && conversationId) {
      try { ContentResolver.delete(`content://sms/conversations/${conversationId}`); } catch { /* noop */ }
    }
    throw error;
  }
}

export function getUnreadCount(): number {
  return ensureSmsSnapshot().conversations.filter((conversation) => conversation.isUnread).length;
}
