import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Toast } from '@/os/components/Toast';
import { AppIcon } from '../../../os/components/AppIcon';
import {
  getAppManifest,
  getLocalizedAppName,
  isValidAppId,
} from '../../../os/data/appRegistry';
import {
  deleteNode,
  formatFileSize,
  getNode,
  listDirectory,
  searchFiles,
} from '../../../os/FileSystemService';
import { routeGetPreference, routeSetPreference } from '../../../os/managers/registry';
import type { AppManifest } from '../../../os/types/manifest';
import type { OsDefaultOpenCategory } from '../../../os/OsStateStore';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsGestures } from '../hooks/useSettingsGestures';
import { PreferenceCategory } from './PreferenceCategory';
import { PreferenceItem } from './PreferenceItem';
import { SettingsHeader } from './SettingsHeader';

const CACHE_SUFFIXES = ['/cache', '/code_cache', '/tmp', '/files/cache'] as const;

const CATEGORY_MIME_TYPES: Record<OsDefaultOpenCategory, readonly string[]> = {
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png'],
  document: [
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
};

function pathIsInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function mimeMatches(filterType: string | undefined, mimeType: string): boolean {
  if (!filterType) return false;
  if (filterType === '*/*' || filterType === mimeType) return true;
  const slash = filterType.indexOf('/');
  return slash > 0 && filterType.endsWith('/*') && mimeType.startsWith(filterType.slice(0, slash + 1));
}

export function getDefaultOpenCategoriesForManifest(manifest: AppManifest): OsDefaultOpenCategory[] {
  const viewFilters = (manifest.intentFilters || []).filter((filter) => filter.action === 'ACTION_VIEW');
  return (Object.keys(CATEGORY_MIME_TYPES) as OsDefaultOpenCategory[]).filter((category) =>
    CATEGORY_MIME_TYPES[category].some((mimeType) =>
      viewFilters.some((filter) => mimeMatches(filter.type, mimeType)),
    ),
  );
}

export interface ApplicationPrivateStorageStats {
  privateRoot: string;
  totalBytes: number;
  cacheBytes: number;
  cacheDirectories: string[];
}

export function getApplicationPrivateStorageStats(appId: string): ApplicationPrivateStorageStats {
  const privateRoot = `/data/data/${appId}`;
  const files = searchFiles('', { path: privateRoot, type: 'file' })
    .filter((node) => pathIsInside(node.path, privateRoot));
  const cacheDirectories = CACHE_SUFFIXES
    .map((suffix) => `${privateRoot}${suffix}`)
    .filter((path) => getNode(path)?.type === 'directory');
  const isCacheFile = (path: string) => cacheDirectories.some((root) => pathIsInside(path, root));

  return {
    privateRoot,
    totalBytes: files.reduce((total, file) => total + Math.max(0, file.size || 0), 0),
    cacheBytes: files
      .filter((file) => isCacheFile(file.path))
      .reduce((total, file) => total + Math.max(0, file.size || 0), 0),
    cacheDirectories,
  };
}

export async function clearApplicationCache(appId: string): Promise<{
  removedEntries: number;
  freedBytes: number;
}> {
  const before = getApplicationPrivateStorageStats(appId);
  let removedEntries = 0;

  for (const cacheDirectory of before.cacheDirectories) {
    const descendants = searchFiles('', { path: cacheDirectory })
      .filter((node) => node.path !== cacheDirectory && pathIsInside(node.path, cacheDirectory));
    removedEntries += descendants.length;
    const children = listDirectory(cacheDirectory);
    for (const child of children) {
      await deleteNode(child.path);
    }
  }

  const after = getApplicationPrivateStorageStats(appId);
  return {
    removedEntries,
    freedBytes: Math.max(0, before.cacheBytes - after.cacheBytes),
  };
}

function defaultOpenPreferenceKey(category: OsDefaultOpenCategory): string {
  return `secure_default_open_${category}`;
}

export const ApplicationDetailPage: React.FC<{ appId: string }> = ({ appId }) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useSettingsGestures();
  const manifest = isValidAppId(appId) ? getAppManifest(appId) : undefined;
  const [storageRevision, setStorageRevision] = useState(0);
  const [toast, setToast] = useState({ visible: false, message: '' });
  const toastTimerRef = useRef<number | undefined>(undefined);
  const clearingRef = useRef(false);

  const showToast = (message: string) => {
    setToast({ visible: true, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: false }));
    }, 1800);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  void storageRevision;
  const storage = getApplicationPrivateStorageStats(appId);
  const defaultOpenCategories = useMemo(
    () => manifest ? getDefaultOpenCategoriesForManifest(manifest) : [],
    [manifest],
  );

  if (!manifest) {
    return (
      <div className="flex h-full flex-col bg-app-bg">
        <SettingsHeader title={s.app_info} />
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div>
            <div className="text-[14px] font-medium text-app-text-muted">{s.app_not_found}</div>
            <div className="mt-1 text-[12px] text-gray-400">{s.app_id_label}{appId || s.empty}</div>
          </div>
        </div>
      </div>
    );
  }

  const categoryLabels: Record<OsDefaultOpenCategory, string> = {
    pdf: s.pdf_files,
    image: s.image_files,
    document: s.document_files,
  };

  const handleClearCache = async () => {
    if (clearingRef.current) return;
    if (storage.cacheDirectories.length === 0 || storage.cacheBytes === 0) {
      showToast(s.no_cache_to_clear);
      return;
    }
    clearingRef.current = true;
    try {
      const result = await clearApplicationCache(appId);
      setStorageRevision((value) => value + 1);
      showToast(result.freedBytes > 0
        ? s.cache_cleared_with_size.replace('${size}', formatFileSize(result.freedBytes))
        : s.no_cache_to_clear);
    } catch {
      showToast(s.cache_clear_failed);
    } finally {
      clearingRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={s.app_info} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div className="mx-4 mt-2 rounded-2xl bg-app-surface p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <AppIcon manifest={manifest} size={54} radius={15} showShadow />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[18px] font-semibold text-app-text">
                {getLocalizedAppName(manifest.id)}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-gray-400">{manifest.packageName}</div>
              <div className="mt-0.5 text-[12px] text-gray-400">
                {s.version_label.replace('${version}', manifest.version)}
              </div>
            </div>
          </div>
        </div>

        <PreferenceCategory title={s.app_controls}>
          <PreferenceItem
            title={s.app_notifications}
            summary={s.manage_this_app_notifications}
            itemProps={bindTap<HTMLDivElement>('page.open', {
              params: { pageId: `notification_app__${encodeURIComponent(appId)}` },
            })}
          />
          <PreferenceItem
            title={s.permissions}
            summary={s.manage_this_app_permissions}
            showDivider={false}
            itemProps={bindTap<HTMLDivElement>('page.open', {
              params: { pageId: `app_permission_detail__${encodeURIComponent(appId)}` },
            })}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.storage_and_cache}>
          <PreferenceItem
            title={s.private_storage}
            summary={storage.privateRoot}
            value={formatFileSize(storage.totalBytes)}
            showChevron={false}
          />
          <PreferenceItem
            title={s.cache}
            summary={storage.cacheDirectories.length > 0 ? s.real_cache_directories_only : s.no_cache_directory}
            value={formatFileSize(storage.cacheBytes)}
            showChevron={false}
          />
          <PreferenceItem
            title={s.clear_cache}
            summary={s.clear_cache_keeps_app_data}
            showChevron={false}
            showDivider={false}
            itemProps={bindTap<HTMLDivElement>(
              { kind: 'action', id: 'settings.app.cache.clear' },
              {
                params: { appId },
                onTrigger: () => { void handleClearCache(); },
              },
            )}
          />
        </PreferenceCategory>

        {defaultOpenCategories.length > 0 ? (
          <PreferenceCategory title={s.open_by_default}>
            {defaultOpenCategories.map((category, index) => {
              const selectedAppId = routeGetPreference(defaultOpenPreferenceKey(category));
              const selected = selectedAppId === appId;
              return (
                <PreferenceItem
                  key={category}
                  title={categoryLabels[category]}
                  summary={selected ? s.current_default_open_app : s.set_as_default_open_app}
                  value={selected ? s.default_label : undefined}
                  showChevron={false}
                  showDivider={index < defaultOpenCategories.length - 1}
                  itemProps={bindTap<HTMLDivElement>(
                    { kind: 'action', id: 'settings.app.defaultOpen.set' },
                    {
                      params: { appId, category },
                      onTrigger: () => {
                        routeSetPreference(defaultOpenPreferenceKey(category), appId, { source: 'settings' });
                        showToast(s.default_open_app_updated);
                      },
                    },
                  )}
                />
              );
            })}
          </PreferenceCategory>
        ) : null}
      </div>
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
};

export default ApplicationDetailPage;
