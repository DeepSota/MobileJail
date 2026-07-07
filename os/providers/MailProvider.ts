import ContentProvider from '../ContentProvider';
import ContentResolver from '../ContentResolver';
import { createOsStore } from '../createOsStore';
import * as TimeService from '../TimeService';
import type { ContentUri, ContentValues, Cursor } from '../types/content';
import type {
  AttachmentType,
  DraftInput,
  MailAccount,
  MailAttachment,
  MailFolder,
  MailMessage,
  RealFolderId,
} from '../../system/Mail/types';
import mailDefaults from './defaults/mail.json';

export interface MailProviderState {
  accounts: MailAccount[];
  folders: MailFolder[];
  messages: MailMessage[];
  attachments: MailAttachment[];
}

const randomId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${TimeService.now().toString(36).slice(-4)}`;

const defaultState: MailProviderState = {
  accounts: structuredClone(mailDefaults.accounts) as MailAccount[],
  folders: structuredClone(mailDefaults.folders) as MailFolder[],
  messages: structuredClone(mailDefaults.messages) as MailMessage[],
  attachments: structuredClone(mailDefaults.attachments) as MailAttachment[],
};

export const useMailProviderStore = createOsStore<MailProviderState>(
  'provider.mail',
  defaultState,
  {
    persistName: 'provider_mail',
    registerToServiceRegistry: false,
    registerToProviderRegistry: true,
  },
);

function pickProjection<T extends Record<string, any>>(item: T, projection?: string[]): Record<string, any> {
  if (!projection || projection.length === 0) return item;
  const out: Record<string, any> = {};
  for (const key of projection) {
    if (key in item) out[key] = item[key];
  }
  return out;
}

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0);
}

function asAttachments(v: any, messageId: string): Array<Omit<MailAttachment, 'id' | 'messageId'>> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      name: typeof x.name === 'string' ? x.name : 'untitled',
      type: (typeof x.type === 'string' ? x.type : 'other') as AttachmentType,
      mimeType: typeof x.mimeType === 'string' ? x.mimeType : 'application/octet-stream',
      size: typeof x.size === 'number' ? x.size : 0,
      ...(typeof x.uri === 'string' ? { uri: x.uri } : {}),
    }));
}

function realFolderList(): ReadonlyArray<RealFolderId> {
  return ['inbox', 'drafts', 'sent', 'trash'];
}

function isRealFolder(folder: string): folder is RealFolderId {
  return (realFolderList() as readonly string[]).includes(folder);
}

export class MailProvider extends ContentProvider {
  query(uri: ContentUri, projection?: string[]): Cursor<any> {
    const parsed = ContentResolver.parseUri(uri);
    const path = parsed.path;
    const state = useMailProviderStore.getState();

    // --- accounts ---
    if (path === '/accounts' || path === '/accounts/') {
      return { items: state.accounts.map((x) => pickProjection(x as any, projection)), count: state.accounts.length };
    }
    const accountMatch = path.match(/^\/accounts\/([^/]+)$/);
    if (accountMatch) {
      const acc = state.accounts.find((x) => x.id === accountMatch[1]);
      return acc ? { items: [pickProjection(acc as any, projection)], count: 1 } : { items: [], count: 0 };
    }

    // --- folders ---
    if (path === '/folders' || path === '/folders/') {
      const accountId = String(parsed.query.get('account') ?? '').trim();
      const items = accountId
        ? state.folders.filter((f) => f.accountId === accountId)
        : state.folders;
      return { items: items.map((x) => pickProjection(x as any, projection)), count: items.length };
    }
    const folderMatch = path.match(/^\/folders\/([^/]+)$/);
    if (folderMatch) {
      const f = state.folders.find((x) => x.id === folderMatch[1]);
      return f ? { items: [pickProjection(f as any, projection)], count: 1 } : { items: [], count: 0 };
    }

    // --- messages ---
    if (path === '/messages' || path === '/messages/') {
      const folderParam = String(parsed.query.get('folder') ?? '').trim();
      let items = state.messages.slice();
      if (folderParam === 'starred') {
        items = items.filter((m) => m.isStarred && m.folder !== 'trash');
      } else if (folderParam === 'all') {
        // all real folders except trash by default — but keep it explicit, do not filter
      } else if (isRealFolder(folderParam)) {
        items = items.filter((m) => m.folder === folderParam);
      }
      return { items: items.map((x) => pickProjection(x as any, projection)), count: items.length };
    }
    const messageMatch = path.match(/^\/messages\/([^/]+)$/);
    if (messageMatch) {
      const m = state.messages.find((x) => x.id === messageMatch[1]);
      return m ? { items: [pickProjection(m as any, projection)], count: 1 } : { items: [], count: 0 };
    }

    // --- attachments ---
    if (path === '/attachments' || path === '/attachments/') {
      const messageId = String(parsed.query.get('message') ?? '').trim();
      const items = messageId
        ? state.attachments.filter((a) => a.messageId === messageId)
        : state.attachments;
      return { items: items.map((x) => pickProjection(x as any, projection)), count: items.length };
    }
    const attachmentMatch = path.match(/^\/attachments\/([^/]+)$/);
    if (attachmentMatch) {
      const a = state.attachments.find((x) => x.id === attachmentMatch[1]);
      return a ? { items: [pickProjection(a as any, projection)], count: 1 } : { items: [], count: 0 };
    }

    return { items: [], count: 0 };
  }

  insert(uri: ContentUri, values: ContentValues): ContentUri {
    const parsed = ContentResolver.parseUri(uri);

    if (parsed.path === '/messages' || parsed.path === '/messages/') {
      // Used by saveDraft() to create a fresh draft.
      const folder: RealFolderId =
        typeof values.folder === 'string' && isRealFolder(values.folder) ? values.folder : 'drafts';
      const id = randomId('msg');
      const now = TimeService.formatTime();
      const msg: MailMessage = {
        id,
        accountId: typeof values.accountId === 'string' ? values.accountId : 'acc_sim',
        folder,
        from: typeof values.from === 'string' ? values.from : 'me@sim-mail.com',
        ...(typeof values.fromName === 'string' ? { fromName: values.fromName } : {}),
        to: asStringArray(values.to),
        cc: asStringArray(values.cc),
        subject: typeof values.subject === 'string' ? values.subject : '',
        body: typeof values.body === 'string' ? values.body : '',
        timestamp: now,
        isUnread: Boolean(values.isUnread),
        isStarred: Boolean(values.isStarred),
        isDraft: true,
        status: 'draft',
        ...(typeof values.inReplyTo === 'string' && values.inReplyTo ? { inReplyTo: values.inReplyTo } : {}),
      };
      (useMailProviderStore.setState as any)((state: MailProviderState) => {
        state.messages = [msg, ...state.messages];
        const newAttachments = asAttachments(values.attachments, id).map((a) => ({
          ...a,
          id: randomId('att'),
          messageId: id,
        }));
        if (newAttachments.length) state.attachments = [...state.attachments, ...newAttachments];
      });
      return `content://mail/messages/${id}`;
    }

    if (parsed.path === '/attachments' || parsed.path === '/attachments/') {
      const messageId = String(parsed.query.get('message') ?? values.messageId ?? '').trim();
      if (!messageId) throw new Error('[MailProvider] messageId is required when inserting an attachment');
      const id = randomId('att');
      const att: MailAttachment = {
        id,
        messageId,
        name: typeof values.name === 'string' ? values.name : 'untitled',
        type: (typeof values.type === 'string' ? values.type : 'other') as AttachmentType,
        mimeType: typeof values.mimeType === 'string' ? values.mimeType : 'application/octet-stream',
        size: typeof values.size === 'number' ? values.size : 0,
        ...(typeof values.uri === 'string' ? { uri: values.uri } : {}),
      };
      (useMailProviderStore.setState as any)((state: MailProviderState) => {
        state.attachments = [...state.attachments, att];
      });
      return `content://mail/attachments/${id}`;
    }

    throw new Error(`[MailProvider] Unsupported insert URI: ${parsed.path}`);
  }

  update(uri: ContentUri, values: ContentValues, _where?: string): number {
    const parsed = ContentResolver.parseUri(uri);

    const messageMatch = parsed.path.match(/^\/messages\/([^/]+)$/);
    if (messageMatch) {
      const id = messageMatch[1];
      const exists = useMailProviderStore.getState().messages.some((m) => m.id === id);
      if (!exists) return 0;
      (useMailProviderStore.setState as any)((state: MailProviderState) => {
        state.messages = state.messages.map((m) => {
          if (m.id !== id) return m;
          const patch: Partial<MailMessage> = {};
          if (typeof values.to === 'object' && Array.isArray(values.to)) patch.to = asStringArray(values.to);
          if (typeof values.cc === 'object' && Array.isArray(values.cc)) patch.cc = asStringArray(values.cc);
          if (typeof values.subject === 'string') patch.subject = values.subject;
          if (typeof values.body === 'string') patch.body = values.body;
          if (typeof values.folder === 'string' && isRealFolder(values.folder)) patch.folder = values.folder;
          if ('isUnread' in values) patch.isUnread = Boolean(values.isUnread);
          if ('isStarred' in values) patch.isStarred = Boolean(values.isStarred);
          if (typeof values.timestamp === 'string') patch.timestamp = values.timestamp;
          if (typeof values.status === 'string') patch.status = values.status as MailMessage['status'];
          if ('isDraft' in values) patch.isDraft = Boolean(values.isDraft);
          if (typeof values.fromName === 'string') patch.fromName = values.fromName;
          if (typeof values.from === 'string') patch.from = values.from;
          return { ...m, ...patch } as MailMessage;
        });
      });
      return 1;
    }

    return 0;
  }

  delete(uri: ContentUri, _where?: string): number {
    const parsed = ContentResolver.parseUri(uri);

    const messageMatch = parsed.path.match(/^\/messages\/([^/]+)$/);
    if (messageMatch) {
      const id = messageMatch[1];
      const exists = useMailProviderStore.getState().messages.some((m) => m.id === id);
      if (!exists) return 0;
      (useMailProviderStore.setState as any)((state: MailProviderState) => {
        state.messages = state.messages.filter((m) => m.id !== id);
        state.attachments = state.attachments.filter((a) => a.messageId !== id);
      });
      return 1;
    }

    const attachmentMatch = parsed.path.match(/^\/attachments\/([^/]+)$/);
    if (attachmentMatch) {
      const id = attachmentMatch[1];
      const exists = useMailProviderStore.getState().attachments.some((a) => a.id === id);
      if (!exists) return 0;
      (useMailProviderStore.setState as any)((state: MailProviderState) => {
        state.attachments = state.attachments.filter((a) => a.id !== id);
      });
      return 1;
    }

    return 0;
  }

  getType(uri: ContentUri): string {
    const parsed = ContentResolver.parseUri(uri);
    if (parsed.path.match(/^\/messages\/[^/]+$/)) return 'vnd.android.cursor.item/mail-message';
    if (parsed.path.match(/^\/messages/)) return 'vnd.android.cursor.dir/mail-message';
    if (parsed.path.match(/^\/attachments\/[^/]+$/)) return 'vnd.android.cursor.item/mail-attachment';
    if (parsed.path.match(/^\/attachments/)) return 'vnd.android.cursor.dir/mail-attachment';
    if (parsed.path.match(/^\/folders\/[^/]+$/)) return 'vnd.android.cursor.item/mail-folder';
    if (parsed.path.match(/^\/folders/)) return 'vnd.android.cursor.dir/mail-folder';
    if (parsed.path.match(/^\/accounts\/[^/]+$/)) return 'vnd.android.cursor.item/mail-account';
    return 'vnd.android.cursor.dir/mail-account';
  }
}

let mailProvider: MailProvider | null = null;

export function ensureMailProviderRegistered(): void {
  if (!mailProvider) {
    mailProvider = new MailProvider();
  }
  ContentResolver.registerProvider('mail', mailProvider);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mailProvider = null;
  });
}

// --- Free-function mutators consumed by system/Mail/state.ts ---

/** Save (create or update) a draft. Returns the draft message id. */
export function saveDraft(input: DraftInput): string {
  ensureMailProviderRegistered();
  const existing = input.id
    ? ContentResolver.query<MailMessage>(`content://mail/messages/${input.id}`).items[0]
    : null;

  if (existing) {
    ContentResolver.update(`content://mail/messages/${existing.id}`, {
      to: input.to,
      cc: input.cc ?? [],
      subject: input.subject,
      body: input.body,
      status: 'draft',
      isDraft: true,
      folder: 'drafts',
      timestamp: TimeService.formatTime(),
    });
    // Replace attachments: remove existing then insert new for simplicity.
    const existingAttachments = ContentResolver.query<MailAttachment>(
      `content://mail/attachments?message=${existing.id}`,
    ).items;
    existingAttachments.forEach((a) => {
      ContentResolver.delete(`content://mail/attachments/${a.id}`);
    });
    (input.attachments ?? []).forEach((a) => {
      ContentResolver.insert(`content://mail/attachments?message=${existing.id}`, a);
    });
    return existing.id;
  }

  const uri = ContentResolver.insert('content://mail/messages', {
    accountId: 'acc_sim',
    folder: 'drafts',
    from: 'me@sim-mail.com',
    fromName: '我',
    to: input.to,
    cc: input.cc ?? [],
    subject: input.subject,
    body: input.body,
    isUnread: false,
    isStarred: false,
    isDraft: true,
    status: 'draft',
    inReplyTo: input.inReplyTo,
    attachments: input.attachments ?? [],
  });
  return String(uri.split('/').pop() ?? '');
}

/** Send a draft (or a fresh message). Moves the message to 'sent' and marks as sent. */
export function sendDraft(messageId: string): string | null {
  ensureMailProviderRegistered();
  const msg = ContentResolver.query<MailMessage>(`content://mail/messages/${messageId}`).items[0];
  if (!msg) return null;
  // If it's still a draft, move it to sent. Already-sent messages are no-ops.
  ContentResolver.update(`content://mail/messages/${messageId}`, {
    folder: 'sent',
    isDraft: false,
    status: 'sent',
    timestamp: TimeService.formatTime(),
    from: 'me@sim-mail.com',
    fromName: '我',
  });
  return messageId;
}

export default MailProvider;
