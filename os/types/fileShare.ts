import type { FSNode } from '../types';

export const FILE_REF_VERSION = 1 as const;
export const SHARE_PAYLOAD_VERSION = 1 as const;

/**
 * Serializable, path-independent reference to a file in SimFileSystem.
 * `fileId` and `uri` stay stable when a user moves or renames the file.
 */
export interface FileRefV1 {
  version: typeof FILE_REF_VERSION;
  fileId: string;
  uri: `content://simfs/files/${string}`;
  /** Current virtual path for migration/debug only; fileId remains authoritative. */
  path?: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: number;
  thumbnailUri?: string;
  width?: number;
  height?: number;
}

/** Serializable ACTION_SEND payload understood by every receiving App. */
export interface SharePayloadV1 {
  version: typeof SHARE_PAYLOAD_VERSION;
  files: FileRefV1[];
  mimeType: string;
  text?: string;
  subject?: string;
}

export type FileShareInput = FileRefV1 | FSNode | string;

export interface OpenedFileRef {
  ref: FileRefV1;
  node: FSNode;
  blob: Blob;
  objectUrl: string;
  revoke: () => void;
}
