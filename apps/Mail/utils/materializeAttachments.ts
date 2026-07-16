import {
  clonePayloadForApp,
  createPayload,
  resolveFileRef,
} from '@/os/FileShareService';
import type { FileRefV1 } from '@/os/types/fileShare';

export const MAIL_PRIVATE_ATTACHMENT_PREFIX = '/data/data/mail/attachments/';

export interface FileRefAttachment {
  uri?: string;
  fileRef?: FileRefV1;
}

export interface MaterializedMailAttachments<T> {
  attachments: T[];
  createdFiles: FileRefV1[];
}

/**
 * Clone non-Mail refs into Mail's private area once per unique source id.
 * Existing private refs are reused on subsequent draft saves/sends.
 */
export async function materializeMailAttachmentsWithCopies<T extends FileRefAttachment>(
  attachments: readonly T[],
): Promise<MaterializedMailAttachments<T>> {
  const resolvedByAttachment = attachments.map((attachment) => {
    if (!attachment.fileRef) return null;
    const resolved = resolveFileRef(attachment.fileRef);
    if (!resolved) throw new Error('[Mail] Attachment source no longer exists');
    return resolved;
  });

  const uniqueExternalRefs = new Map<string, FileRefV1>();
  for (const resolved of resolvedByAttachment) {
    if (!resolved || resolved.node.path.startsWith(MAIL_PRIVATE_ATTACHMENT_PREFIX)) continue;
    uniqueExternalRefs.set(resolved.ref.fileId, resolved.ref);
  }

  const clonedBySourceId = new Map<string, FileRefV1>();
  const createdFiles: FileRefV1[] = [];
  if (uniqueExternalRefs.size > 0) {
    const sourceRefs = [...uniqueExternalRefs.values()];
    // Use the platform's transactional multi-file clone so one stale/failed
    // attachment cannot leave other Mail-private orphan copies behind.
    const savedPayload = await clonePayloadForApp(createPayload(sourceRefs), 'mail');
    sourceRefs.forEach((source, index) => {
      const saved = savedPayload.files[index];
      if (!saved) throw new Error('[Mail] Attachment copy result is incomplete');
      clonedBySourceId.set(source.fileId, saved);
      createdFiles.push(saved);
    });
  }

  const materialized = attachments.map((attachment, index) => {
    const resolved = resolvedByAttachment[index];
    if (!resolved) return attachment;
    const saved = resolved.node.path.startsWith(MAIL_PRIVATE_ATTACHMENT_PREFIX)
      ? resolved.ref
      : clonedBySourceId.get(resolved.ref.fileId);
    if (!saved) throw new Error('[Mail] Attachment copy result is incomplete');
    return { ...attachment, uri: saved.uri, fileRef: saved };
  });
  return { attachments: materialized, createdFiles };
}

export async function materializeMailAttachments<T extends FileRefAttachment>(
  attachments: readonly T[],
): Promise<T[]> {
  return (await materializeMailAttachmentsWithCopies(attachments)).attachments;
}
