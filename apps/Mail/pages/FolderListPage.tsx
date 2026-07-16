import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IcNavBack, IcSearch, IcMailOpen, IcAdd, IcMenu, IcClose, ICON_REGISTRY } from '../res/icons';
import { FOLDER_CATALOG, DEFAULT_FOLDER } from '../constants';
import type { FolderId } from '../types';
import {
  useMailProviderState,
  listMessagesByFolder,
  markFolderRead,
} from '../state';
import { MailItem } from './components/MailItem';
import { useMailGestures } from '../hooks/useMailGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';

const EMPTY_KEY: Record<FolderId, string> = {
  inbox: 'list_empty_inbox',
  starred: 'list_empty_starred',
  drafts: 'list_empty_drafts',
  sent: 'list_empty_sent',
  trash: 'list_empty_trash',
};

export const FolderListPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { go, bindTap, bindBack } = useMailGestures();
  const [searchParams, setSearchParams] = useSearchParams();
  const folder = (searchParams.get('folder') as FolderId | null) ?? DEFAULT_FOLDER;
  const menuOpen = searchParams.get('menu') === 'open';
  const providerState = useMailProviderState();
  const [query, setQuery] = useState('');

  // Use provider state subscription; memoize list
  const messages = useMemo(() => listMessagesByFolder(folder), [folder, providerState]);

  const attachmentsCounts = useMemo(() => {
    const m: Record<string, number> = {};
    messages.forEach((msg) => {
      m[msg.id] = providerState.attachmentsByMessageId[msg.id]?.length ?? 0;
    });
    return m;
  }, [messages, providerState.attachmentsByMessageId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        (m.fromName ?? m.from).toLowerCase().includes(q),
    );
  }, [messages, query]);

  const folderMeta = FOLDER_CATALOG.find((f) => f.id === folder) ?? FOLDER_CATALOG[0];
  const folderIcon = ICON_REGISTRY[folderMeta.icon];
  const folderLabel = s[folderMeta.labelKey as keyof typeof s] as string;
  const unreadInFolder = messages.filter((m) => m.isUnread).length;

  // Counts per folder for sidebar
  const sidebarCounts = useMemo(() => {
    const m: Record<FolderId, { unread: number; total: number }> = {
      inbox: { unread: 0, total: 0 },
      starred: { unread: 0, total: 0 },
      drafts: { unread: 0, total: 0 },
      sent: { unread: 0, total: 0 },
      trash: { unread: 0, total: 0 },
    };
    FOLDER_CATALOG.forEach((f) => {
      const list = listMessagesByFolder(f.id);
      m[f.id] = { unread: list.filter((x) => x.isUnread).length, total: list.length };
    });
    return m;
  }, [providerState]);

  const handleMarkAllRead = () => {
    markFolderRead(folder);
  };

  const handleFolderPick = (targetFolder: FolderId) => {
    go('menu.folder.switch', { folder: targetFolder });
  };

  return (
    <div className="h-full bg-app-bg flex flex-col" data-status-bar-foreground="dark">
      {/* Status bar spacer */}
      <div className="h-10 flex-shrink-0" />

      {/* Header */}
      <div className="flex items-center px-4 h-12 flex-shrink-0">
        <button
          type="button"
          {...bindTap('menu.open')}
          className="w-9 h-9 -ml-1 flex items-center justify-center"
        >
          <IcMenu size={22} className="text-app-text" />
        </button>
        <button
          type="button"
          {...bindTap('folders.open')}
          className="text-[17px] font-medium text-app-text ml-1 active:opacity-70"
        >
          {folderLabel}
        </button>
        {unreadInFolder > 0 && (
          <span className="ml-2 text-[12px] text-gray-400">
            {unreadInFolder} {s.list_unread_suffix}
          </span>
        )}
        <div className="ml-auto" />
        {unreadInFolder > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="text-[13px] text-app-primary px-2 py-1"
          >
            {s.action_mark_all_read}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 pb-2 flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-app-surface rounded-lg">
          <IcSearch size={16} className="text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 text-[14px] text-app-text outline-none bg-transparent"
            placeholder={s.action_compose}
          />
        </div>
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 px-8 text-center">
            <IcMailOpen size={48} className="text-gray-300 mb-3" />
            <span className="text-[14px]">{s[EMPTY_KEY[folder] as keyof typeof s] as string}</span>
          </div>
        ) : (
          filtered.map((msg) => (
            <MailItem
              key={msg.id}
              message={msg}
              folder={folder}
              attachmentsCount={attachmentsCounts[msg.id] ?? 0}
              onClick={() => go('message.open', { messageId: msg.id })}
            />
          ))
        )}
      </div>

      {/* Compose FAB */}
      <button
        type="button"
        {...bindTap('compose.open')}
        className="absolute right-5 bottom-7 h-14 pl-4 pr-5 rounded-full bg-app-primary shadow-xl flex items-center gap-2 active:scale-95 transition-transform"
        aria-label={s.action_compose}
      >
        <IcAdd size={22} className="text-white" strokeWidth={2.5} />
        <span className="text-white text-[15px] font-medium">{s.action_compose}</span>
      </button>

      {/* ── Left sidebar drawer ── */}
      {menuOpen && (
        <div className="fixed inset-0 z-[100] flex">
          {/* Backdrop — tapping closes sidebar via back */}
          <div
            className="absolute inset-0 bg-black/30"
            {...bindBack()}
          />
          {/* Sidebar panel */}
          <div className="relative w-[75%] max-w-[300px] h-full bg-white shadow-xl flex flex-col animate-in slide-in-from-left duration-200">
            {/* Sidebar header */}
            <div className="h-10 flex-shrink-0" />
            <div className="flex items-center justify-between px-5 h-14 flex-shrink-0 border-b border-gray-100">
              <span className="text-[20px] font-semibold text-app-text">{s.title_mailbox}</span>
              <button
                type="button"
                {...bindBack()}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
              >
                <IcClose size={16} className="text-app-text-muted" />
              </button>
            </div>
            {/* Folder list */}
            <div className="flex-1 overflow-y-auto py-2">
              {FOLDER_CATALOG.map((f) => {
                const Icon = ICON_REGISTRY[f.icon];
                const meta = sidebarCounts[f.id];
                const isCurrent = f.id === folder;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleFolderPick(f.id)}
                    className={`w-full flex items-center gap-3 px-5 py-3.5 active:bg-gray-50 ${isCurrent ? 'bg-app-primary/5' : ''}`}
                    data-action="menu.folder.switch"
                    data-action-type="tap"
                    data-action-params={JSON.stringify({ folder: f.id })}
                  >
                    <div className="w-9 h-9 rounded-lg bg-app-primary/10 flex items-center justify-center shrink-0">
                      {Icon && <Icon size={20} className="text-app-primary" />}
                    </div>
                    <span className={`flex-1 text-left text-[15px] ${isCurrent ? 'text-app-primary font-semibold' : 'text-app-text'}`}>
                      {s[f.labelKey as keyof typeof s] as string}
                    </span>
                    {meta.unread > 0 && (
                      <span className="text-[12px] text-white bg-app-primary rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                        {meta.unread}
                      </span>
                    )}
                    {meta.unread === 0 && meta.total > 0 && (
                      <span className="text-[12px] text-gray-400">{meta.total}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* silence unused import noise */}
      <span className="hidden">{s.title_mailbox}</span>
      <span className="hidden"><IcNavBack /></span>
    </div>
  );
};

export default FolderListPage;
