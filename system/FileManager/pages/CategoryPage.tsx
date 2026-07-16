/**
 * Category Page
 * 
 * Shows files filtered by category (images, videos, audio, documents)
 */
import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { IcCheck, IcClose, IcFile, IcNavBack, IcShare, IcVideo } from '../res/icons';
import { FSNode } from '../../../os/types';
import * as FileSystem from '../../../os/FileSystemService';
import { AsyncImage } from '../components/AsyncImage';
import { getFileIcon, getFileIconColor } from '../utils/fileUtils';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { getFileOpenTarget, useOpenFile } from '../hooks/useOpenFile';
import { UnsupportedFileSheet } from '../components/UnsupportedFileSheet';
import { isDocumentLikeFile } from '../viewer/fileFormatRegistry';
import { shareNodes } from '../utils/fileOperations';
export const CategoryPage: React.FC = () => {
  const { category } = useParams<{ category: string }>();
  const location = useLocation();
  const { bindBack, go } = useFileManagerGestures();
  const { openFile, unsupportedFile, dismissUnsupportedFile } = useOpenFile();
  const [items, setItems] = useState<FSNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const s = useAppStrings(strings, stringsEn);
  const selecting = new URLSearchParams(location.search).get('mode') === 'select';

  useEffect(() => {
    if (!selecting) setSelectedIds(new Set());
  }, [selecting]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const beginLongPress = (item: FSNode) => {
    longPressTriggered.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setSelectedIds(new Set([item.id]));
      go('category.select.enter', { category: category || 'documents' });
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const activateItem = (item: FSNode) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    if (selecting) {
      toggleSelected(item.id);
      return;
    }
    openFile(item);
  };

  const categoryInfo = {
    images: { name: s.category_images, mimePrefix: 'image/' },
    videos: { name: s.category_videos, mimePrefix: 'video/' },
    audio: { name: s.category_audio_alt, mimePrefix: 'audio/' },
    documents: { name: s.category_documents, mimePrefix: 'application/' },
  }[category || ''] || { name: s.category_files, mimePrefix: '' };
  
  useEffect(() => {
    let files: FSNode[];
    
    if (category === 'images') {
      files = FileSystem.getMediaFiles('image');
    } else if (category === 'videos') {
      files = FileSystem.getMediaFiles('video');
    } else if (category === 'audio') {
      files = FileSystem.getMediaFiles('audio');
    } else if (category === 'documents') {
      files = FileSystem.searchFiles('', { type: 'file' })
        .filter(isDocumentLikeFile)
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
    } else {
      files = FileSystem.searchFiles('', { mimeType: categoryInfo.mimePrefix, type: 'file' });
    }
    
    setItems(files.filter(file => !file.path.startsWith('/data/data/')));
  }, [category, categoryInfo.mimePrefix]);
  
  return (
    <div className="h-full bg-app-surface flex flex-col">
      {/* Header */}
      <div className="pt-10 px-4 pb-3 flex items-center gap-3 border-b border-gray-100">
        <button
          {...bindBack()}
          className="w-10 h-10 flex items-center justify-center -ml-2"
        >
          {selecting ? <IcClose size={24} className="text-app-text" /> : <IcNavBack size={28} className="text-app-text" />}
        </button>
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold text-app-text">
            {selecting ? s.selected_count.replace('${count}', String(selectedIds.size)) : categoryInfo.name}
          </h1>
          {!selecting ? <span className="text-[13px] text-gray-500">{items.length}{s.fm_file_count_suffix}</span> : null}
        </div>
        {selecting ? (
          <button
            type="button"
            onClick={() => setSelectedIds(selectedIds.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
            data-action="category.select.all.toggle"
            data-action-type="tap"
            className="w-10 h-10 flex items-center justify-center"
            aria-label={s.select_items_prompt}
          >
            <IcCheck size={22} className="text-app-primary" />
          </button>
        ) : null}
      </div>
      
      {/* File grid */}
      <div 
        className="flex-1 overflow-y-auto"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <IcFile size={48} className="mb-3" />
            <span>{s.category_empty_prefix}{categoryInfo.name}</span>
          </div>
        ) : category === 'images' || category === 'videos' ? (
          // Grid view for media
          <div className="grid grid-cols-4 gap-(--app-grid-gap) p-[2px]">
            {items.map(item => {
              const isImage = item.mimeType?.startsWith('image/');
              return (
                <div
                  key={item.id}
                  className="aspect-square bg-gray-100 relative active:opacity-70"
                  onPointerDown={() => beginLongPress(item)}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onClick={() => activateItem(item)}
                  data-trigger={!selecting ? 'category.select.enter' : undefined}
                  data-trigger-type={!selecting ? 'longPress' : undefined}
                  data-trigger-params={!selecting ? JSON.stringify({ category: category || 'documents' }) : undefined}
                  {...(selecting ? {
                    'data-action': 'category.select.item.toggle',
                    'data-action-type': 'tap',
                    'data-action-params': JSON.stringify({ path: item.path }),
                  } : isImage ? {
                    'data-action': 'category.file.image.open',
                    'data-action-type': 'tap',
                    'data-action-params': JSON.stringify({ path: item.path }),
                  } : {})}
                >
                  <AsyncImage
                    path={item.path}
                    className="w-full h-full object-cover"
                    alt={item.name}
                  />
                  {item.mimeType?.startsWith('video/') && (
                    <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/50 rounded px-1.5 py-0.5">
                      <IcVideo size={12} className="text-white" />
                    </div>
                  )}
                  {selectedIds.has(item.id) ? (
                    <div className="absolute inset-0 bg-blue-500/25 ring-2 ring-inset ring-blue-500 flex items-start justify-end p-1.5">
                      <span className="w-6 h-6 rounded-full bg-blue-500 text-white grid place-items-center"><IcCheck size={16} /></span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          // List view for other files
          <div className="divide-y divide-gray-100">
            {items.map(item => {
              const Icon = getFileIcon(item);
              const iconColor = getFileIconColor(item);
              const openTarget = getFileOpenTarget(item);
              const openAttrs = openTarget === 'viewer'
                ? {
                    'data-trigger': 'file.viewer.open',
                    'data-trigger-type': 'tap',
                    'data-trigger-params': JSON.stringify({ path: item.path }),
                  }
                : openTarget === 'unsupported'
                  ? {
                      'data-trigger': 'category.file.unsupported.open',
                      'data-trigger-type': 'tap',
                      'data-trigger-params': JSON.stringify({ category: category || '', itemPath: item.path }),
                    }
                : {
                    'data-action': 'category.file.image.open',
                    'data-action-type': 'tap',
                    'data-action-params': JSON.stringify({ path: item.path }),
                  };
              
              return (
                <button
                  key={item.id}
                  type="button"
                  onPointerDown={() => beginLongPress(item)}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onClick={() => activateItem(item)}
                  data-trigger={!selecting ? 'category.select.enter' : undefined}
                  data-trigger-type={!selecting ? 'longPress' : undefined}
                  data-trigger-params={!selecting ? JSON.stringify({ category: category || 'documents' }) : undefined}
                  {...(selecting ? {
                    'data-action': 'category.select.item.toggle',
                    'data-action-type': 'tap',
                    'data-action-params': JSON.stringify({ path: item.path }),
                  } : openAttrs)}
                  className={`flex w-full items-center gap-4 px-4 py-3 text-left active:bg-gray-50 ${selectedIds.has(item.id) ? 'bg-blue-50' : ''}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Icon size={24} className={iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] text-app-text truncate">{item.name}</div>
                    <div className="text-[12px] text-gray-500">
                      {FileSystem.formatFileSize(item.size)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selecting ? (
        <div className="h-[64px] shrink-0 border-t border-gray-100 bg-white px-5 flex items-center justify-center">
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => shareNodes(items.filter((item) => selectedIds.has(item.id)))}
            data-action="category.select.send"
            data-action-type="tap"
            className="min-w-[120px] h-11 rounded-full bg-app-primary text-white flex items-center justify-center gap-2 disabled:opacity-35"
          >
            <IcShare size={20} />
            <span>{s.action_send}</span>
          </button>
        </div>
      ) : null}

      <UnsupportedFileSheet file={unsupportedFile} onClose={dismissUnsupportedFile} />
    </div>
  );
};

export default CategoryPage;
