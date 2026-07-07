import { useSyncExternalStore } from 'react';
import { createAppStoreWithActions } from '../../os/createAppStore';
import { MAIL_CONFIG } from './data';
import ContentResolver from '../../os/ContentResolver';
import {
  ensureMailProviderRegistered,
  saveDraft as providerSaveDraft,
  sendDraft as providerSendDraft,
} from '../../os/providers/MailProvider';
import * as TimeService from '../../os/TimeService';
import { NotificationService } from '../../os/NotificationService';
import { AVATAR_COLOR_PALETTE } from './constants';
import type {
  DraftInput,
  FolderId,
  MailAccount,
  MailAttachment,
  MailFolder,
  MailMessage,
} from './types';

// --- Mail app Zustand store (UI settings only) ---

interface MailState {
  settings: Record<string, boolean>;
  _temp: { pendingTimers: number[] };
}

interface MailActions {
  updateSettings: (patch: Record<string, boolean>) => void;
  trackTimer: (timerId: number) => void;
  untrackTimer: (timerId: number) => void;
  clearTimers: () => void;
}

const initialState: MailState = {
  settings: { ...MAIL_CONFIG.settings },
  _temp: { pendingTimers: [] },
};

export const useMailStore = createAppStoreWithActions<MailState, MailActions>(
  'mail',
  initialState,
  (set, get) => ({
    updateSettings(patch: Record<string, boolean>) {
      set((state) => ({ settings: { ...state.settings, ...patch } }));
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
  }),
  {
    partialize: (state) => {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(state)) {
        if (typeof v !== 'function' && k !== '_temp') result[k] = v;
      }
      return result as Partial<MailState>;
    },
  },
);

// --- Provider state via useSyncExternalStore ---

export interface MailSnapshot {
  accounts: MailAccount[];
  folders: MailFolder[];
  messages: MailMessage[];
  attachmentsByMessageId: Record<string, MailAttachment[]>;
}

const emptySnapshot: MailSnapshot = {
  accounts: [],
  folders: [],
  messages: [],
  attachmentsByMessageId: {},
};

function buildMailSnapshot(): MailSnapshot {
  ensureMailProviderRegistered();
  const accounts = ContentResolver.query<MailAccount>('content://mail/accounts').items;
  const folders = ContentResolver.query<MailFolder>('content://mail/folders').items;
  const messages = ContentResolver.query<MailMessage>('content://mail/messages').items;
  const attachments = ContentResolver.query<MailAttachment>('content://mail/attachments').items;

  const attachmentsByMessageId: Record<string, MailAttachment[]> = {};
  attachments.forEach((a) => {
    const arr = attachmentsByMessageId[a.messageId] ?? [];
    arr.push(a);
    attachmentsByMessageId[a.messageId] = arr;
  });

  return { accounts, folders, messages, attachmentsByMessageId };
}

let _mailSnapshot: MailSnapshot | null = null;

function ensureMailSnapshot(): MailSnapshot {
  if (!_mailSnapshot) _mailSnapshot = buildMailSnapshot();
  return _mailSnapshot;
}

function subscribeMail(listener: () => void): () => void {
  return ContentResolver.registerContentObserver('content://mail', () => {
    _mailSnapshot = buildMailSnapshot();
    listener();
  });
}

function getMailSnapshot(): MailSnapshot {
  return ensureMailSnapshot();
}

function getEmptyMailSnapshot(): MailSnapshot {
  return emptySnapshot;
}

export function useMailProviderState(): MailSnapshot {
  return useSyncExternalStore(subscribeMail, getMailSnapshot, getEmptyMailSnapshot);
}

/** Invalidate the cached mail snapshot so the next read rebuilds from the provider.
 *  Needed when mutating the provider and immediately reading (e.g. saveDraft then navigate). */
export function invalidateMailSnapshot(): void {
  _mailSnapshot = null;
}

// --- Helpers ---

const randomId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${TimeService.now().toString(36).slice(-4)}`;

export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLOR_PALETTE[hash % AVATAR_COLOR_PALETTE.length];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate an email address. Allows `Name <addr@x.y>` form too. */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const bracket = v.match(/^.*<([^>]+)>$/);
  const addr = bracket ? bracket[1].trim() : v;
  return EMAIL_RE.test(addr);
}

export function extractEmailAddress(value: string): string {
  const v = value.trim();
  const bracket = v.match(/^.*<([^>]+)>$/);
  return bracket ? bracket[1].trim() : v;
}

export function listMessagesByFolder(folder: FolderId): MailMessage[] {
  return ensureMailSnapshot().messages.filter((m) => {
    if (folder === 'starred') return m.isStarred && m.folder !== 'trash';
    return m.folder === folder;
  });
}

export function getMessage(id: string): MailMessage | undefined {
  return ensureMailSnapshot().messages.find((m) => m.id === id);
}

export function getAttachments(messageId: string): MailAttachment[] {
  return ensureMailSnapshot().attachmentsByMessageId[messageId] ?? [];
}

export function getAccount(): MailAccount | undefined {
  return ensureMailSnapshot().accounts[0];
}

// --- Mutators ---

/** Create a brand-new draft (reply / forward / new) and return its id. */
export function createDraft(input: Omit<DraftInput, 'id'>): string {
  return providerSaveDraft({ ...input, id: undefined });
}

/** Update an existing draft or create one if `id` is missing. */
export function saveDraft(input: DraftInput): string {
  return providerSaveDraft(input);
}

/** Send a message that already exists as a draft. Returns the messageId (now in 'sent'). */
export function sendMessage(messageId: string): string | null {
  ensureMailProviderRegistered();
  const msg = getMessage(messageId);
  if (!msg) return null;
  // Briefly show 'sending' state before flipping to 'sent' (mirrors SMS pattern).
  ContentResolver.update(`content://mail/messages/${messageId}`, { status: 'sending' });
  const timerId = window.setTimeout(() => {
    providerSendDraft(messageId);
    useMailStore.getState().untrackTimer(timerId);
  }, 300);
  useMailStore.getState().trackTimer(timerId);
  return messageId;
}

export function deleteMessageForever(messageId: string): void {
  ensureMailProviderRegistered();
  ContentResolver.delete(`content://mail/messages/${messageId}`);
  NotificationService.dismissByRoute('mail', `/message/${messageId}`);
}

export function moveToTrash(messageId: string): void {
  ensureMailProviderRegistered();
  ContentResolver.update(`content://mail/messages/${messageId}`, { folder: 'trash' });
  NotificationService.dismissByRoute('mail', `/message/${messageId}`);
}

export function restoreFromTrash(messageId: string): void {
  ensureMailProviderRegistered();
  ContentResolver.update(`content://mail/messages/${messageId}`, { folder: 'inbox' });
}

export function markRead(messageId: string): void {
  ensureMailProviderRegistered();
  ContentResolver.update(`content://mail/messages/${messageId}`, { isUnread: false });
}

export function markUnread(messageId: string): void {
  ensureMailProviderRegistered();
  ContentResolver.update(`content://mail/messages/${messageId}`, { isUnread: true });
}

export function toggleStar(messageId: string, starred: boolean): void {
  ensureMailProviderRegistered();
  ContentResolver.update(`content://mail/messages/${messageId}`, { isStarred: starred });
}

export function addAttachment(
  messageId: string,
  attach: Omit<MailAttachment, 'id' | 'messageId'>,
): string {
  ensureMailProviderRegistered();
  const uri = ContentResolver.insert(`content://mail/attachments?message=${messageId}`, attach);
  return String(uri.split('/').pop() ?? randomId('att'));
}

export function removeAttachment(attachmentId: string): void {
  ensureMailProviderRegistered();
  ContentResolver.delete(`content://mail/attachments/${attachmentId}`);
}

export function getUnreadCount(folder: FolderId = 'inbox'): number {
  return listMessagesByFolder(folder).filter((m) => m.isUnread).length;
}

export function markFolderRead(folder: FolderId = 'inbox'): number {
  ensureMailProviderRegistered();
  const targets = listMessagesByFolder(folder).filter((m) => m.isUnread);
  targets.forEach((m) => {
    ContentResolver.update(`content://mail/messages/${m.id}`, { isUnread: false });
  });
  if (targets.length > 0) NotificationService.clearForApp('mail');
  return targets.length;
}
