import { rollbackPrivateAttachments } from '@/os/FileShareService';
import type { FileRefV1 } from '@/os/types/fileShare';

/** Remove App-owned copies that never became part of a Direct Message. */
export async function removeUnsentSharedAttachments(files: readonly FileRefV1[]): Promise<boolean> {
  await rollbackPrivateAttachments(files, 'x');
  return true;
}
