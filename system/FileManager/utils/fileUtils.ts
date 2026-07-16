/**
 * File Manager Utilities
 * 
 * Helper functions for file type detection and icons
 */
import {
  IcFolder, IcFile, IcImage, IcVideo, IcMusic, IcFileText
} from '../res/icons';
import { FSNode } from '../../../os/types';
import { classifyFileFormat, isSupportedDocument } from '../viewer/fileFormatRegistry';

export function isTextPreviewableFile(node: FSNode): boolean {
  if (node.type !== 'file') return false;
  return classifyFileFormat(node).kind === 'text';
}

export function isPdfPreviewableFile(node: FSNode): boolean {
  if (node.type !== 'file') return false;
  return classifyFileFormat(node).kind === 'pdf';
}

export function isDocumentViewerSupportedFile(node: FSNode): boolean {
  return node.type === 'file' && isSupportedDocument(node);
}

export function getFileIcon(node: FSNode) {
  if (node.type === 'directory') return IcFolder;
  
  const mime = node.mimeType || '';
  if (mime.startsWith('image/')) return IcImage;
  if (mime.startsWith('video/')) return IcVideo;
  if (mime.startsWith('audio/')) return IcMusic;
  if (classifyFileFormat(node).extension) return IcFileText;
  if (mime.includes('pdf') || mime.includes('document') || mime.includes('text')) return IcFileText;
  return IcFile;
}

export function getFileIconColor(node: FSNode): string {
  if (node.type === 'directory') return 'text-amber-500';
  
  const mime = node.mimeType || '';
  if (mime.startsWith('image/')) return 'text-green-500';
  if (mime.startsWith('video/')) return 'text-purple-500';
  if (mime.startsWith('audio/')) return 'text-pink-500';
  const format = classifyFileFormat(node);
  if (format.kind === 'pdf') return 'text-red-500';
  if (format.kind === 'word') return 'text-blue-600';
  if (format.kind === 'spreadsheet') return 'text-emerald-600';
  if (format.kind === 'presentation') return 'text-orange-600';
  if (format.kind === 'text') return 'text-slate-500';
  return 'text-gray-500';
}
