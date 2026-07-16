import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { FSNode } from '@/os/types';
import * as FileSystem from '@/os/FileSystemService';
import { createViewIntent } from '@/os/FileShareService';
import { useFileManagerGestures } from './useFileManagerGestures';
import { classifyFileFormat, FILE_FORMAT_REGISTRY, getFileExtension } from '../viewer/fileFormatRegistry';

export type FileOpenTarget = 'folder' | 'image' | 'viewer' | 'unsupported';

/** Pure routing decision shared by the hook, UI metadata and unit tests. */
export function getFileOpenTarget(node: FSNode): FileOpenTarget {
  if (node.type === 'directory') return 'folder';
  const extension = getFileExtension(node);
  const registered = FILE_FORMAT_REGISTRY[extension];
  if (registered) return registered.supported ? 'viewer' : 'unsupported';
  if (node.mimeType?.toLowerCase().startsWith('image/')) return 'image';
  return classifyFileFormat(node).supported ? 'viewer' : 'unsupported';
}

/**
 * Unified file opener for Browse, Folder, Recent and Category entry points.
 * Unsupported files remain on the current page and are surfaced through the
 * returned bottom-sheet state.
 */
export function useOpenFile() {
  const { go, back } = useFileManagerGestures();
  const location = useLocation();

  const unsupportedFile = useMemo(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('modal') !== 'unsupported') return null;
    const itemPath = params.get('itemPath');
    return itemPath ? FileSystem.getNode(itemPath) : null;
  }, [location.search]);

  const dismissUnsupportedFile = useCallback(() => {
    if (unsupportedFile) back();
  }, [back, unsupportedFile]);

  const openFile = useCallback((node: FSNode) => {
    const target = getFileOpenTarget(node);

    if (target === 'folder') {
      go('folder.open', { path: node.path });
      return;
    }

    if (target === 'image') {
      const intent = createViewIntent(node, { targetAppId: 'gallery' });
      if (intent) window.__OS__?.startActivity?.(intent);
      return;
    }

    if (target === 'viewer') {
      go('file.viewer.open', { path: node.path });
      return;
    }

    if (location.pathname === '/') {
      go('browse.file.unsupported.open', { itemPath: node.path });
      return;
    }
    if (location.pathname === '/recent') {
      go('recent.file.unsupported.open', { itemPath: node.path });
      return;
    }
    if (location.pathname === '/folder') {
      go('folder.file.unsupported.open', { itemPath: node.path });
      return;
    }
    if (location.pathname.startsWith('/category/')) {
      const category = decodeURIComponent(location.pathname.slice('/category/'.length));
      go('category.file.unsupported.open', { category, itemPath: node.path });
    }
  }, [go, location.pathname]);

  return {
    openFile,
    unsupportedFile,
    dismissUnsupportedFile,
  };
}

export default useOpenFile;
