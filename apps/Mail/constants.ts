import type { AttachmentType, FolderId, MailFolder } from './types';

/** Folder catalog — order is the display order in the folder picker.
 *  Labels are i18n keys (res/strings.ts); icons are Ic* aliases. */
export const FOLDER_CATALOG: ReadonlyArray<{ id: FolderId; labelKey: string; icon: string }> = [
  { id: 'inbox',   labelKey: 'folder_inbox',   icon: 'IcInbox' },
  { id: 'starred', labelKey: 'folder_starred', icon: 'IcStar' },
  { id: 'drafts',  labelKey: 'folder_drafts',  icon: 'IcEdit' },
  { id: 'sent',    labelKey: 'folder_sent',    icon: 'IcSend' },
  { id: 'trash',   labelKey: 'folder_trash',   icon: 'IcTrash' },
];

export const DEFAULT_FOLDER: FolderId = 'inbox';

/** Mail app does not actually wire AttachmentPanel to startActivityForResult; each tile adds a
 *  mock attachment of the given type to the current draft. Each tile carries canned file metadata
 *  so the compose UI has something realistic to render. */
export interface AttachmentTileOption {
  type: AttachmentType;
  labelKey: string;
  icon: string;
  /** Canned mock file picked when the tile is tapped. */
  mockFile: { name: string; mimeType: string; size: number };
}

export const ATTACHMENT_TYPE_OPTIONS: ReadonlyArray<AttachmentTileOption> = [
  {
    type: 'image',
    labelKey: 'attach_type_image',
    icon: 'IcImage',
    mockFile: { name: 'photo_2026.jpg', mimeType: 'image/jpeg', size: 1_240_000 },
  },
  {
    type: 'document',
    labelKey: 'attach_type_document',
    icon: 'IcDocument',
    mockFile: { name: 'report.pdf', mimeType: 'application/pdf', size: 384_000 },
  },
  {
    type: 'video',
    labelKey: 'attach_type_video',
    icon: 'IcVideo',
    mockFile: { name: 'clip_2026.mp4', mimeType: 'video/mp4', size: 9_800_000 },
  },
  {
    type: 'audio',
    labelKey: 'attach_type_audio',
    icon: 'IcAudio',
    mockFile: { name: 'voice_note.m4a', mimeType: 'audio/mp4', size: 220_000 },
  },
  {
    type: 'camera',
    labelKey: 'attach_type_camera',
    icon: 'IcCamera',
    mockFile: { name: 'camera_shot.jpg', mimeType: 'image/jpeg', size: 2_100_000 },
  },
  {
    type: 'other',
    labelKey: 'attach_type_other',
    icon: 'IcFile',
    mockFile: { name: 'archive.zip', mimeType: 'application/zip', size: 540_000 },
  },
];

/** Avatar color palette used when creating ad-hoc senders/conversations outside Contacts. */
export const AVATAR_COLOR_PALETTE = [
  '#07C160', '#3482FF', '#FF6B00', '#7C3AED', '#06B6D4', '#EF4444', '#F59E0B', '#10B981',
] as const;

/** Build a static folder list for one account. Unread counts are computed on demand by the page. */
export function buildFolderList(accountId: string): MailFolder[] {
  return FOLDER_CATALOG.map((f) => ({ id: f.id, accountId, icon: f.icon }));
}
