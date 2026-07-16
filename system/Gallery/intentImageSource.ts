import * as FileShareService from '@/os/FileShareService';
import type { IntentPayload } from '@/os/types/manifest';

export interface IntentImageSource {
  path: string;
  readOnly: boolean;
}

export function isPrivateAttachmentPath(path: string): boolean {
  return path.startsWith('/data/data/');
}

/** Resolve canonical FileRefs/content URIs and enforce private URI grants. */
export function resolveIntentImageSource(
  payload: IntentPayload | null | undefined,
): IntentImageSource | null {
  if (!payload || payload.action !== 'ACTION_VIEW') return null;
  if (payload.type && !payload.type.startsWith('image/')) return null;
  const resolved = FileShareService.resolveViewIntent(payload, 'gallery');
  if (!resolved || resolved.node.type !== 'file') return null;
  return {
    path: resolved.node.path,
    readOnly: isPrivateAttachmentPath(resolved.node.path),
  };
}
