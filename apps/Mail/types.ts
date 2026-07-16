export type FolderId = 'inbox' | 'starred' | 'drafts' | 'sent' | 'trash';

/** Message.folder is one of these (real compartments). 'starred' is a virtual view filter,
 *  resolved by the provider as `?folder=starred` (returns `isStarred === true` across all real folders). */
export type RealFolderId = 'inbox' | 'drafts' | 'sent' | 'trash';

export type AttachmentType = 'image' | 'document' | 'video' | 'audio' | 'camera' | 'other';

export interface MailAccount {
  id: string;
  displayName: string;
  email: string;
  avatarColor: string;
  signature?: string;
}

export interface MailFolder {
  id: FolderId;
  accountId: string;
  /** Ic* alias — rendered via ICON_REGISTRY in icons.tsx */
  icon: string;
}

export interface MailMessage {
  id: string;
  accountId: string;
  folder: RealFolderId;
  from: string;          // sender email address
  fromName?: string;     // display fallback (Contacts lookup preferred at render time)
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  timestamp: string;     // formatted via TimeService.formatTime()
  isUnread: boolean;
  isStarred: boolean;
  isDraft: boolean;
  inReplyTo?: string;    // original messageId for replies
  status?: 'sending' | 'sent' | 'draft';
}

export interface MailAttachment {
  id: string;
  messageId: string;
  name: string;
  type: AttachmentType;
  mimeType: string;
  size: number;          // bytes
  uri?: string;
  fileRef?: import('../../os/types/fileShare').FileRefV1;
}

export interface DraftInput {
  id?: string;           // existing draft id; undefined for new
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: Array<Omit<MailAttachment, 'id' | 'messageId'>>;
  inReplyTo?: string;
}
