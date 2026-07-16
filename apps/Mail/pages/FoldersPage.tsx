import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IcNavBack, ICON_REGISTRY } from '../res/icons';
import { FOLDER_CATALOG, DEFAULT_FOLDER } from '../constants';
import type { FolderId } from '../types';
import { useMailProviderState, listMessagesByFolder } from '../state';
import { useMailGestures } from '../hooks/useMailGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';

export const FoldersPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { go, bindBack } = useMailGestures();
  const [searchParams] = useSearchParams();
  const current = (searchParams.get('folder') as FolderId | null) ?? DEFAULT_FOLDER;
  const providerState = useMailProviderState();

  // Counts per folder (unread / total), driven by provider subscription
  const counts = useMemo(() => {
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

  const handlePick = (folder: FolderId) => {
    go('folder.switch', { folder });
  };

  return (
    <div className="h-full bg-app-surface flex flex-col" data-status-bar-foreground="dark">
      <div className="h-10 flex-shrink-0" />

      <div className="flex items-center px-4 h-12 flex-shrink-0">
        <button
          type="button"
          {...bindBack()}
          className="w-10 h-10 -ml-2 flex items-center justify-center"
        >
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <span className="text-[17px] font-medium text-app-text ml-2">{s.title_folders}</span>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {FOLDER_CATALOG.map((f) => {
          const Icon = ICON_REGISTRY[f.icon];
          const meta = counts[f.id];
          const isCurrent = f.id === current;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => handlePick(f.id)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 border-b border-gray-100 ${isCurrent ? 'bg-app-primary/5' : ''}`}
              data-trigger="folder.switch"
              data-trigger-type="tap"
              data-trigger-params={JSON.stringify({ folder: f.id })}
            >
              <div className="w-9 h-9 rounded-lg bg-app-primary/10 flex items-center justify-center">
                {Icon && <Icon size={20} className="text-app-primary" />}
              </div>
              <span className={`flex-1 text-left text-[15px] ${isCurrent ? 'text-app-primary font-medium' : 'text-app-text'}`}>
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
  );
};

export default FoldersPage;
