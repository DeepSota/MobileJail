import React, { useEffect, useState } from 'react';
import * as FileSystem from '../../../os/FileSystemService';
import { IcNavBack, IcFile } from '../res/icons';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';

interface FSNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  mimeType?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const FolderIcon: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

interface SelectFileOverlayProps {
  onSelect: (file: { path: string; name: string; size: number; mimeType: string }) => void;
  onClose: () => void;
}

export const SelectFileOverlay: React.FC<SelectFileOverlayProps> = ({ onSelect, onClose }) => {
  const s = useAppStrings(strings, stringsEn);

  const [currentDir, setCurrentDir] = useState('/sdcard');
  const [items, setItems] = useState<FSNode[]>([]);
  const [dirStack, setDirStack] = useState<string[]>([]);

  useEffect(() => {
    try {
      const nodes = FileSystem.listDirectory(currentDir) as unknown as FSNode[];
      const sorted = [...(nodes || [])].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      setItems(sorted);
    } catch {
      setItems([]);
    }
  }, [currentDir]);

  const handleOpenDir = (path: string) => {
    setDirStack((prev) => [...prev, currentDir]);
    setCurrentDir(path);
  };

  const handleGoUp = () => {
    if (dirStack.length > 0) {
      const prev = dirStack[dirStack.length - 1];
      setDirStack((stack) => stack.slice(0, -1));
      setCurrentDir(prev);
    }
  };

  const handleSelectFile = (item: FSNode) => {
    onSelect({
      path: item.path,
      name: item.name,
      size: item.size ?? 0,
      mimeType: item.mimeType || 'application/octet-stream',
    });
  };

  const canGoUp = dirStack.length > 0;

  return (
    <div className="absolute inset-0 z-50 bg-app-bg flex flex-col" data-status-bar-foreground="dark">
      <div className="h-10 flex-shrink-0" />

      {/* Header */}
      <div className="flex items-center px-4 h-12 flex-shrink-0">
        <button className="w-10 h-10 -ml-2 flex items-center justify-center" onClick={onClose}>
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-[16px] font-medium text-app-text">{s.select_file_title}</div>
        </div>
        <div className="w-10 h-10 -mr-2" />
      </div>

      {/* Breadcrumb */}
      <div className="px-4 py-2 text-[12px] text-gray-400 truncate border-b border-gray-100 bg-app-surface">
        {currentDir}
      </div>

      {/* Go up */}
      {canGoUp ? (
        <button
          type="button"
          className="w-full px-4 py-3 flex items-center gap-3 active:bg-black/5 text-left border-b border-gray-100 bg-app-surface"
          onClick={handleGoUp}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-[14px] text-gray-500">..</span>
        </button>
      ) : null}

      {/* File list */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {items.length === 0 ? (
          <div className="text-center text-[13px] text-gray-400 mt-10">{s.empty_file_list}</div>
        ) : (
          items.map((item) => (
            <button
              key={item.path}
              type="button"
              className="w-full px-4 py-3 flex items-center gap-3 active:bg-black/5 text-left border-b border-gray-50 bg-app-surface"
              onClick={() => {
                if (item.type === 'directory') {
                  handleOpenDir(item.path);
                } else {
                  handleSelectFile(item);
                }
              }}
            >
              {item.type === 'directory' ? <FolderIcon /> : (
                <IcFile size={22} className="text-gray-500" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-app-text truncate">{item.name}</div>
                {item.type === 'file' && item.size != null ? (
                  <div className="text-[11px] text-gray-400">{formatFileSize(item.size)}</div>
                ) : null}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default SelectFileOverlay;