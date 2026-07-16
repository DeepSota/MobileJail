import React from 'react';
import type { AppId } from '../types';
import type { IntentPayload } from '../types/manifest';
import { getAppManifest, getLocalizedAppName } from '../data/appRegistry';
import { AppIcon } from './AppIcon';
import { useOsT } from '../i18n';

export const IntentChooserSheet: React.FC<{
  open: boolean;
  intent: IntentPayload | null;
  matches: { appId: AppId }[];
  onChoose: (appId: AppId) => void;
  onCancel: () => void;
}> = ({ open, intent, matches, onChoose, onCancel }) => {
  const t = useOsT();
  if (!open) return null;
  const embedded = intent?.data?.sharePayload ?? intent?.data?.payload;
  const fileCount = Array.isArray(embedded?.files) ? embedded.files.length : 0;
  const summary = fileCount > 0
    ? `${t('发送')} ${fileCount === 1 ? t('1 个文件') : `${fileCount} ${t('个文件')}`}`
    : t('分享内容');

  return (
    <div className="fixed inset-0 pointer-events-auto" style={{ zIndex: 5200 }}>
      <div className="absolute inset-0 bg-black/35" onClick={onCancel} />
      <div className="absolute left-0 right-0 bottom-0 max-h-[78%] overflow-y-auto rounded-t-3xl bg-white px-5 pt-4 pb-7 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-300" />
        <div className="text-[18px] font-semibold text-gray-900">{t('选择应用')}</div>
        <div className="mt-1 text-[13px] text-gray-500">{summary}</div>
        <div className="mt-5 grid grid-cols-4 gap-y-5">
          {matches.map((match) => {
            const manifest = getAppManifest(match.appId);
            if (!manifest) return null;
            return (
              <button
                key={`${match.appId}`}
                type="button"
                className="flex flex-col items-center gap-2 active:scale-95 transition-transform"
                onClick={() => onChoose(match.appId)}
              >
                <AppIcon manifest={manifest} size={52} radius={14} showShadow />
                <span className="w-full px-1 text-[12px] leading-4 text-center text-gray-700 truncate">
                  {getLocalizedAppName(match.appId)}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-6 h-11 w-full rounded-xl border border-gray-200 text-[15px] text-gray-700 active:bg-gray-50"
          onClick={onCancel}
        >
          {t('取消')}
        </button>
      </div>
    </div>
  );
};

export default IntentChooserSheet;
