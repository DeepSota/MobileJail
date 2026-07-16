import type { FSNode } from '@/os/types';
import * as FileSystem from '@/os/FileSystemService';
import * as FileShareService from '@/os/FileShareService';

export type TransferOperation = 'copy' | 'move';

export async function transferNodesToDirectory(
  nodes: FSNode[],
  destPath: string,
  operation: TransferOperation,
): Promise<boolean> {
  if (nodes.length === 0) return false;

  try {
    for (const node of nodes) {
      const destNodePath = `${destPath}/${node.name}`;
      if (operation === 'move') {
        const moved = await FileSystem.moveNode(node.path, destNodePath);
        if (!moved) return false;
      } else {
        const copied = await copyNodeToPath(node, destNodePath);
        if (!copied) return false;
      }
    }
    return true;
  } catch (error) {
    console.error('[FileManager] Transfer failed:', error);
    return false;
  }
}

/**
 * Fire ACTION_SEND for image files in selection. Returns true if at least one
 * image was found and the intent was dispatched.
 *
 * 用 startActivity + newTask 走 fire-and-forget 语义（接收方如微信声明 launchMode='singleTask'
 * 时会留在自己 Task）。FileManager 不需要回执，与真机分享行为一致。
 */
export function shareNodesAsImages(nodes: FSNode[]): boolean {
  return shareNodes(nodes.filter((node) => node.type === 'file' && node.mimeType?.startsWith('image/')));
}

/**
 * Fire ACTION_SEND for non-image files in selection. Returns true if at least one
 * non-image file was found and the intent was dispatched.
 */
export function shareNodesAsFiles(nodes: FSNode[]): boolean {
  return shareNodes(nodes.filter((node) => node.type === 'file' && !node.mimeType?.startsWith('image/')));
}

/** Share images and documents together through stable content:// references. */
export function shareNodes(nodes: FSNode[]): boolean {
  const files = nodes.filter((node) => node.type === 'file');
  if (files.length === 0) return false;
  let payload;
  try {
    payload = FileShareService.createPayload(files);
  } catch (error) {
    console.error('[FileManager] Unable to build share payload:', error);
    return false;
  }
  return window.__OS__?.startActivity?.(
    FileShareService.createSendIntent(payload),
    { newTask: true },
  ) ?? false;
}

async function copyNodeToPath(node: FSNode, destPath: string): Promise<boolean> {
  if (node.type === 'file') {
    const copied = await FileSystem.copyFile(node.path, destPath);
    return Boolean(copied);
  }

  await FileSystem.createDirectory(destPath);
  const children = FileSystem.listDirectory(node.path);
  for (const child of children) {
    const copied = await copyNodeToPath(child, `${destPath}/${child.name}`);
    if (!copied) return false;
  }
  return true;
}
