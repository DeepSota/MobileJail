/**
 * Android-style file sharing for SimFileSystem.
 *
 * The public contract deliberately carries stable content:// references rather
 * than mutable paths.  A receiving App calls cloneFileForApp only when the user
 * confirms sending; the resulting private copy then belongs to that App and is
 * unaffected by later changes to the source file.
 */
import * as FileSystem from './FileSystemService';
import { commonMimeType, inferMimeType, normalizeMimeType } from './MimeType';
import type { FSNode } from './types';
import type { IntentPayload } from './types/manifest';
import {
  FILE_REF_VERSION,
  SHARE_PAYLOAD_VERSION,
  type FileRefV1,
  type FileShareInput,
  type OpenedFileRef,
  type SharePayloadV1,
} from './types/fileShare';

const CONTENT_URI_PREFIX = 'content://simfs/files/';
const PRIVATE_ATTACHMENTS_ROOT = '/data/data';
let privateAttachmentSequence = 0;
let readGrantSequence = 0;

interface FileReadGrant {
  fileId: string;
  targetAppId: string;
}

/**
 * Volatile Android-style URI grants. They disappear together with the
 * Activity stack on refresh; a persisted attachment mints a new grant when it
 * is tapped again.
 */
const fileReadGrants = new Map<string, FileReadGrant>();

export interface ResolvedFileRef {
  ref: FileRefV1;
  node: FSNode;
}

export interface CreateSharePayloadOptions {
  text?: string;
  subject?: string;
}

export interface CreateViewIntentOptions {
  route?: string;
  /** App that may consume the temporary private-file read grant. */
  targetAppId?: string;
}

export interface OpenInViewerOptions {
  appId?: string;
  route?: string;
  newTask?: boolean;
}

export function toContentUri(fileId: string): FileRefV1['uri'] {
  const id = String(fileId ?? '').trim();
  if (!id) throw new Error('[FileShare] fileId is required');
  return `${CONTENT_URI_PREFIX}${encodeURIComponent(id)}` as FileRefV1['uri'];
}

export function parseContentUri(uri: string): string | null {
  if (typeof uri !== 'string' || !uri.startsWith(CONTENT_URI_PREFIX)) return null;
  const encodedId = uri.slice(CONTENT_URI_PREFIX.length).split(/[?#]/, 1)[0];
  if (!encodedId || encodedId.includes('/')) return null;
  try {
    const id = decodeURIComponent(encodedId);
    return id.trim() ? id : null;
  } catch {
    return null;
  }
}

export function isPublicSharedPath(path: string): boolean {
  const normalized = String(path ?? '').trim().replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
  return normalized === '/sdcard' || normalized.startsWith('/sdcard/');
}

export function isPrivateAppPath(path: string): boolean {
  const normalized = String(path ?? '').trim().replace(/\/+/g, '/');
  return normalized.startsWith(`${PRIVATE_ATTACHMENTS_ROOT}/`);
}

function inferViewerAppId(mimeType: string): string {
  return mimeType.startsWith('image/') ? 'gallery' : 'file_manager';
}

function createReadGrant(fileId: string, targetAppId: string): string {
  readGrantSequence += 1;
  let randomPart = '';
  try {
    randomPart = globalThis.crypto?.randomUUID?.() ?? '';
  } catch {
    randomPart = '';
  }
  const token = `grant_${readGrantSequence.toString(36)}_${randomPart || Math.random().toString(36).slice(2)}`;
  fileReadGrants.set(token, {
    fileId,
    targetAppId: sanitizeAppId(targetAppId),
  });
  return token;
}

function hasReadGrant(token: unknown, fileId: string, targetAppId: string): boolean {
  if (typeof token !== 'string' || !token) return false;
  const grant = fileReadGrants.get(token);
  return Boolean(
    grant
    && grant.fileId === fileId
    && grant.targetAppId === sanitizeAppId(targetAppId),
  );
}

export function isFileRefV1(value: unknown): value is FileRefV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FileRefV1>;
  return candidate.version === FILE_REF_VERSION
    && typeof candidate.fileId === 'string'
    && candidate.fileId.length > 0
    && typeof candidate.uri === 'string'
    && parseContentUri(candidate.uri) === candidate.fileId
    && typeof candidate.name === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.modifiedAt === 'number';
}

function nodeToFileRef(node: FSNode): FileRefV1 | null {
  if (node.type !== 'file') return null;
  return {
    version: FILE_REF_VERSION,
    fileId: node.id,
    uri: toContentUri(node.id),
    // App-private filesystem paths are never serialized into a durable ref.
    // The stable content URI remains sufficient for clone/open operations.
    ...(isPrivateAppPath(node.path) ? {} : { path: node.path }),
    name: node.name,
    mimeType: inferMimeType(node.name, node.mimeType),
    size: node.size,
    modifiedAt: node.modifiedAt,
    ...(node.thumbnailUri ? { thumbnailUri: node.thumbnailUri } : {}),
    ...(typeof node.width === 'number' ? { width: node.width } : {}),
    ...(typeof node.height === 'number' ? { height: node.height } : {}),
  };
}

function nodeFromString(value: string): FSNode | null {
  const fileId = parseContentUri(value);
  if (fileId) return FileSystem.getNodeById(fileId);

  // Paths are kept for compatibility with existing ACTION_SEND callers.
  if (value.startsWith('/')) {
    // App-private files must enter through a stable id/content URI or an
    // already-resolved FSNode. Never turn a raw private path into a grantable
    // reference, including non-canonical forms with repeated slashes.
    if (isPrivateAppPath(value)) return null;
    return FileSystem.getNode(value);
  }
  return FileSystem.getNodeById(value);
}

function fileIdFromLooseRef(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.fileId === 'string' && candidate.fileId.trim()) {
    return candidate.fileId;
  }
  if (typeof candidate.uri === 'string') return parseContentUri(candidate.uri);
  return null;
}

/** Resolve a FileRef, content URI, stable id, legacy path, or current FSNode. */
export function resolveFileRef(input: FileShareInput): ResolvedFileRef | null {
  let node: FSNode | null = null;

  if (typeof input === 'string') {
    node = nodeFromString(input);
  } else if (isFileRefV1(input)) {
    node = FileSystem.getNodeById(input.fileId);
  } else if (input && typeof input === 'object' && 'id' in input) {
    const candidate = input as FSNode;
    node = FileSystem.getNodeById(candidate.id);
    if (!node && candidate.path) {
      const byPath = FileSystem.getNode(candidate.path);
      if (byPath?.id === candidate.id) node = byPath;
    }
  }

  if (!node || node.type !== 'file') return null;
  const ref = nodeToFileRef(node);
  return ref ? { ref, node } : null;
}

export function createFileRef(input: FileShareInput): FileRefV1 | null {
  return resolveFileRef(input)?.ref ?? null;
}

function normalizeInputs(input: FileShareInput | readonly FileShareInput[]): readonly FileShareInput[] {
  return Array.isArray(input) ? input : [input as FileShareInput];
}

/** Build a serializable payload; no file content is copied at this stage. */
export function createPayload(
  input: FileShareInput | readonly FileShareInput[],
  options: CreateSharePayloadOptions = {},
): SharePayloadV1 {
  const files: FileRefV1[] = [];
  const seen = new Set<string>();

  for (const item of normalizeInputs(input)) {
    const ref = createFileRef(item);
    if (!ref) throw new Error('[FileShare] Cannot share a missing file or directory');
    if (seen.has(ref.fileId)) continue;
    seen.add(ref.fileId);
    files.push(ref);
  }

  const payload: SharePayloadV1 = {
    version: SHARE_PAYLOAD_VERSION,
    files,
    mimeType: files.length > 0
      ? commonMimeType(files.map((file) => file.mimeType))
      : (options.text !== undefined ? 'text/plain' : 'application/octet-stream'),
  };
  if (options.text !== undefined) payload.text = options.text;
  if (options.subject !== undefined) payload.subject = options.subject;
  return payload;
}

function refsFromUnknown(value: unknown): FileRefV1[] {
  const values = Array.isArray(value) ? value : [value];
  const refs: FileRefV1[] = [];
  for (const item of values) {
    if (typeof item === 'string') {
      // Legacy raw streams are supported only for shared storage. A private
      // attachment must be represented by its canonical content URI/FileRef.
      if (item.startsWith('/') && isPrivateAppPath(item)) continue;
      const ref = createFileRef(item);
      if (ref) refs.push(ref);
      continue;
    }

    const fileId = fileIdFromLooseRef(item);
    if (!fileId) continue;
    const ref = createFileRef(fileId);
    if (ref) refs.push(ref);
  }
  return refs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** True when an ACTION_SEND payload claimed at least one file before resolve. */
export function hasFileShareIntentData(intent: IntentPayload | null | undefined): boolean {
  if (!intent || (intent.action !== 'ACTION_SEND' && intent.action !== 'ACTION_SEND_MULTIPLE')) return false;
  const data = asRecord(intent.data) ?? {};
  const embedded = asRecord(data.sharePayload) ?? asRecord(data.payload);
  if (Array.isArray(embedded?.files) && embedded.files.length > 0) return true;
  const values = [
    data.fileRef,
    data.fileRefs,
    data.stream,
    data.EXTRA_STREAM,
    data['android.intent.extra.STREAM'],
    data.uri,
    data.path,
  ];
  return values.some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
}

/**
 * Parse the canonical payload and legacy `data.stream` / EXTRA_STREAM forms.
 * The returned refs are refreshed from FileSystem by id, so moved files still
 * resolve and untrusted metadata from an Intent is never authoritative.
 */
export function parseIntent(intent: IntentPayload | null | undefined): SharePayloadV1 | null {
  if (!intent || (intent.action !== 'ACTION_SEND' && intent.action !== 'ACTION_SEND_MULTIPLE')) {
    return null;
  }

  const data = asRecord(intent.data) ?? {};
  const embedded = asRecord(data.sharePayload) ?? asRecord(data.payload);
  const refs: FileRefV1[] = [];

  if (embedded) refs.push(...refsFromUnknown(embedded.files));
  refs.push(...refsFromUnknown(data.fileRef));
  refs.push(...refsFromUnknown(data.fileRefs));

  const streamValues = [
    data.stream,
    data.EXTRA_STREAM,
    data['android.intent.extra.STREAM'],
    data.uri,
    data.path,
  ];
  for (const value of streamValues) {
    refs.push(...refsFromUnknown(value));
  }

  const files: FileRefV1[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.fileId)) continue;
    seen.add(ref.fileId);
    files.push(ref);
  }

  const embeddedText = embedded?.text;
  const embeddedSubject = embedded?.subject;
  const textValue = embeddedText ?? data.text ?? data.EXTRA_TEXT ?? data['android.intent.extra.TEXT'];
  const subjectValue = embeddedSubject ?? data.subject ?? data.EXTRA_SUBJECT ?? data['android.intent.extra.SUBJECT'];
  const text = typeof textValue === 'string' ? textValue : undefined;
  const subject = typeof subjectValue === 'string' ? subjectValue : undefined;

  if (files.length === 0 && text === undefined && subject === undefined) return null;

  const embeddedMime = normalizeMimeType(
    typeof embedded?.mimeType === 'string' ? embedded.mimeType : undefined,
  );
  const intentMime = normalizeMimeType(intent.type);
  return {
    version: SHARE_PAYLOAD_VERSION,
    files,
    mimeType: files.length > 0
      ? commonMimeType(files.map((file) => file.mimeType))
      : embeddedMime ?? intentMime ?? 'text/plain',
    ...(text !== undefined ? { text } : {}),
    ...(subject !== undefined ? { subject } : {}),
  };
}

/** Build ACTION_SEND or ACTION_SEND_MULTIPLE while retaining legacy stream keys. */
export function createSendIntent(payload: SharePayloadV1): IntentPayload {
  const streams = payload.files.map((file) => file.uri);
  const stream = streams.length === 1 ? streams[0] : streams;
  return {
    action: streams.length > 1 ? 'ACTION_SEND_MULTIPLE' : 'ACTION_SEND',
    // Android exposes the most precise common MIME at the Intent level while
    // retaining every individual FileRef MIME. Mixed selections are */*.
    type: payload.mimeType,
    data: {
      sharePayload: payload,
      ...(streams.length > 0 ? { stream, EXTRA_STREAM: stream } : {}),
      mimeType: payload.mimeType,
      ...(payload.text !== undefined ? { text: payload.text, EXTRA_TEXT: payload.text } : {}),
      ...(payload.subject !== undefined ? { subject: payload.subject, EXTRA_SUBJECT: payload.subject } : {}),
    },
  };
}

export async function readFileRef(input: FileShareInput): Promise<Blob | null> {
  const resolved = resolveFileRef(input);
  return resolved ? FileSystem.readFileById(resolved.ref.fileId) : null;
}

function sanitizeAppId(appId: string): string {
  const safe = String(appId ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!safe) throw new Error('[FileShare] targetAppId is required');
  return safe;
}

function sanitizeFileName(name: string): string {
  const safe = String(name ?? '')
    .replace(/[\\/\u0000-\u001f\u007f]+/g, '_')
    .replace(/^\.+$/, '_')
    .trim();
  return safe || 'attachment';
}

function nextPrivateAttachmentPath(appId: string, name: string): string {
  const root = `${PRIVATE_ATTACHMENTS_ROOT}/${sanitizeAppId(appId)}/attachments`;
  const safeName = sanitizeFileName(name);
  let candidate: string;
  do {
    privateAttachmentSequence += 1;
    candidate = `${root}/att_${privateAttachmentSequence.toString(36)}/${safeName}`;
  } while (FileSystem.exists(candidate));
  return candidate;
}

/**
 * Persist an independent App-owned copy after the user confirms sending.
 * The returned ref, not the source ref, should be stored in message history.
 */
export async function cloneFileForApp(
  source: FileShareInput,
  targetAppId: string,
): Promise<FileRefV1> {
  const resolved = resolveFileRef(source);
  if (!resolved) throw new Error('[FileShare] Source file no longer exists');

  const blob = await FileSystem.readFileById(resolved.ref.fileId);
  if (!blob) throw new Error('[FileShare] Source file content is unavailable');

  const path = nextPrivateAttachmentPath(targetAppId, resolved.ref.name);
  const copied = await FileSystem.writeFile(path, blob, { mimeType: resolved.ref.mimeType });
  const ref = nodeToFileRef(copied);
  if (!ref) throw new Error('[FileShare] Failed to create the App attachment copy');
  return ref;
}

export async function clonePayloadForApp(
  payload: SharePayloadV1,
  targetAppId: string,
): Promise<SharePayloadV1> {
  // Treat a multi-file share as one transaction.  Resolve and read every
  // source before creating the first private attachment so a stale item in a
  // selection can never leave earlier files copied into the receiving App.
  const prepared: Array<{
    resolved: ResolvedFileRef;
    blob: Blob;
    destinationPath: string;
  }> = [];

  for (const file of payload.files) {
    const resolved = resolveFileRef(file);
    if (!resolved) throw new Error('[FileShare] Source file no longer exists');

    const blob = await FileSystem.readFileById(resolved.ref.fileId);
    if (!blob) throw new Error('[FileShare] Source file content is unavailable');

    prepared.push({
      resolved,
      blob,
      destinationPath: nextPrivateAttachmentPath(targetAppId, resolved.ref.name),
    });
  }

  const files: FileRefV1[] = [];
  const attemptedPaths: string[] = [];
  try {
    for (const item of prepared) {
      // Record the path before writing: writeFile may fail after partially
      // materialising a file, and that path must be included in rollback.
      attemptedPaths.push(item.destinationPath);
      const copied = await FileSystem.writeFile(item.destinationPath, item.blob, {
        mimeType: item.resolved.ref.mimeType,
      });
      const ref = nodeToFileRef(copied);
      if (!ref) throw new Error('[FileShare] Failed to create the App attachment copy');
      files.push(ref);
    }
  } catch (error) {
    // Roll back sequentially in reverse order.  Remove both the file and its
    // unique att_* directory: writeFile creates that directory before writing
    // bytes, so a backend failure must not leave an empty private orphan.
    for (const path of attemptedPaths.reverse()) {
      try {
        await FileSystem.deleteNode(path);
      } catch {
        // Continue with the parent cleanup even if a partial file cannot be
        // addressed directly.
      }
      const directory = path.slice(0, path.lastIndexOf('/'));
      try {
        await FileSystem.deleteNode(directory);
      } catch {
        // Preserve and rethrow the original copy failure after best-effort
        // cleanup of every attempted destination.
      }
    }
    throw error;
  }

  return {
    ...payload,
    files,
    mimeType: files.length > 0
      ? commonMimeType(files.map((file) => file.mimeType))
      : payload.mimeType,
  };
}

/**
 * Remove App-private copies that were cloned but never committed to message
 * history. Only the target App's unique `attachments/att_*` children are
 * eligible, so this helper cannot delete arbitrary private state.
 */
export async function rollbackPrivateAttachments(
  files: readonly FileRefV1[],
  targetAppId: string,
): Promise<void> {
  const root = `${PRIVATE_ATTACHMENTS_ROOT}/${sanitizeAppId(targetAppId)}/attachments/`;
  const paths = files.flatMap((file) => {
    const resolved = resolveFileRef(file);
    const path = resolved?.node.path ?? file.path ?? '';
    if (!path) return [];
    if (!path.startsWith(root)) return [];
    const relative = path.slice(root.length);
    const [directory, ...rest] = relative.split('/');
    if (!/^att_[a-z0-9]+$/i.test(directory) || rest.length === 0) return [];
    return [path];
  });

  for (const path of paths.reverse()) {
    try {
      await FileSystem.deleteNode(path);
    } catch {
      // Continue with the unique parent directory cleanup.
    }
    try {
      await FileSystem.deleteNode(path.slice(0, path.lastIndexOf('/')));
    } catch {
      // Best effort: callers must preserve the original commit error.
    }
  }
}

/** Load a ref into an owned object URL. The caller must invoke `revoke()`. */
export async function openAttachment(input: FileShareInput): Promise<OpenedFileRef | null> {
  const resolved = resolveFileRef(input);
  if (!resolved) return null;
  const blob = await FileSystem.readFileById(resolved.ref.fileId);
  if (!blob) return null;
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('[FileShare] Object URLs are unavailable in this environment');
  }

  const objectUrl = URL.createObjectURL(blob);
  let revoked = false;
  return {
    ...resolved,
    blob,
    objectUrl,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
    },
  };
}

export function createViewIntent(
  source: FileShareInput,
  options: CreateViewIntentOptions = {},
): IntentPayload | null {
  const resolved = resolveFileRef(source);
  if (!resolved) return null;
  const targetAppId = options.targetAppId ?? inferViewerAppId(resolved.ref.mimeType);
  const privatePath = isPrivateAppPath(resolved.node.path);
  const grantToken = privatePath
    ? createReadGrant(resolved.ref.fileId, targetAppId)
    : undefined;
  const intentRef: FileRefV1 = privatePath
    ? (({ path: _privatePath, ...refWithoutPath }) => refWithoutPath)(resolved.ref)
    : resolved.ref;
  return {
    action: 'ACTION_VIEW',
    type: resolved.ref.mimeType,
    scheme: 'content',
    ...(options.route ? { route: options.route } : {}),
    data: {
      fileRef: intentRef,
      stream: intentRef.uri,
      uri: intentRef.uri,
      // Raw paths are retained only for public shared storage compatibility.
      // Private attachments must travel through a canonical FileRef + grant.
      ...(privatePath ? {} : { path: resolved.node.path }),
      mimeType: resolved.ref.mimeType,
      targetAppId,
      ...(grantToken ? { grantToken } : {}),
    },
  };
}

/**
 * Resolve ACTION_VIEW input for a specific viewer. Public `/sdcard` files may
 * use the legacy path form; private App data requires a matching volatile
 * grant and a canonical FileRef/content URI.
 */
export function resolveViewIntent(
  intent: IntentPayload | null | undefined,
  targetAppId: string,
): ResolvedFileRef | null {
  if (!intent || intent.action !== 'ACTION_VIEW') return null;
  const data = asRecord(intent.data) ?? {};
  const canonical = data.fileRef ?? data.stream ?? data.uri;
  const candidate = Array.isArray(canonical) ? canonical[0] : canonical;
  const resolved = candidate
    ? resolveFileRef(candidate as FileShareInput)
    : null;

  if (resolved) {
    const rawPath = typeof data.path === 'string' ? data.path : '';
    if (rawPath && rawPath !== resolved.node.path) return null;
    if (isPublicSharedPath(resolved.node.path)) return resolved;
    if (!isPrivateAppPath(resolved.node.path)) return null;
    return hasReadGrant(data.grantToken, resolved.ref.fileId, targetAppId)
      ? resolved
      : null;
  }

  // Legacy public path Intents remain readable during migration. Never apply
  // this compatibility branch to another App's private directory.
  if (typeof data.path === 'string' && isPublicSharedPath(data.path)) {
    return resolveFileRef(data.path);
  }
  return null;
}

/** Open the shared system viewer in the current Task, matching Android ACTION_VIEW. */
export function openFileRefInViewer(
  source: FileShareInput,
  options: OpenInViewerOptions = {},
): boolean {
  const resolved = resolveFileRef(source);
  if (!resolved) return false;
  const appId = options.appId ?? 'file_manager';
  const route = options.route
    ?? (isPublicSharedPath(resolved.node.path)
      ? `/viewer?path=${encodeURIComponent(resolved.node.path)}`
      : '/viewer');
  const intent = createViewIntent(resolved.ref, { route, targetAppId: appId });
  if (!intent || typeof window === 'undefined' || !window.__OS__?.startActivity) return false;
  return window.__OS__.startActivity(
    appId,
    intent,
    { newTask: options.newTask ?? false },
  );
}

export const FileShareService = {
  toContentUri,
  parseContentUri,
  isFileRefV1,
  resolveFileRef,
  createFileRef,
  createPayload,
  parseIntent,
  hasFileShareIntentData,
  createSendIntent,
  readFileRef,
  cloneFileForApp,
  clonePayloadForApp,
  rollbackPrivateAttachments,
  openAttachment,
  createViewIntent,
  resolveViewIntent,
  isPublicSharedPath,
  isPrivateAppPath,
  openFileRefInViewer,
};

export default FileShareService;
