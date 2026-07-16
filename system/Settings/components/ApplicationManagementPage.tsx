import React from 'react';
import { AppIcon } from '../../../os/components/AppIcon';
import { APP_REGISTRY, getLocalizedAppName } from '../../../os/data/appRegistry';
import { formatFileSize } from '../../../os/FileSystemService';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsGestures } from '../hooks/useSettingsGestures';
import { IcNavForward } from '../res/icons';
import { getApplicationPrivateStorageStats } from './ApplicationDetailPage';
import { PreferenceCategory } from './PreferenceCategory';
import { SettingsHeader } from './SettingsHeader';

export const ApplicationManagementPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useSettingsGestures();
  const installed = [...APP_REGISTRY];
  installed.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'system' ? -1 : 1;
    return getLocalizedAppName(left.id).localeCompare(getLocalizedAppName(right.id));
  });
  const apps = installed.map((manifest) => ({
    manifest,
    storageBytes: getApplicationPrivateStorageStats(manifest.id).totalBytes,
  }));

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={s.manage_apps} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div className="px-4 pb-1 pt-2 text-[12px] text-gray-400">
          {s.installed_apps_count.replace('${count}', String(apps.length))}
        </div>
        <PreferenceCategory title={s.installed_apps}>
          {apps.map(({ manifest, storageBytes }, index) => (
            <div key={manifest.id}>
              <div
                className="flex min-h-(--app-preference-item-min-height) items-center px-4 py-3.5 active:bg-gray-50"
                {...bindTap<HTMLDivElement>('page.open', {
                  params: { pageId: `application_detail__${encodeURIComponent(manifest.id)}` },
                })}
              >
                <div className="mr-3 shrink-0">
                  <AppIcon manifest={manifest} size={38} radius={11} showShadow />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] leading-tight text-app-text">
                    {getLocalizedAppName(manifest.id)}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] leading-tight text-gray-400">
                    {manifest.packageName}
                  </div>
                </div>
                <div className="ml-2 flex shrink-0 items-center">
                  <span className="mr-1 text-[12px] text-gray-400">{formatFileSize(storageBytes)}</span>
                  <IcNavForward size={16} className="text-gray-300" />
                </div>
              </div>
              {index < apps.length - 1 ? <div className="ml-[66px] mr-4 h-px bg-gray-100" /> : null}
            </div>
          ))}
        </PreferenceCategory>
      </div>
    </div>
  );
};

export default ApplicationManagementPage;
