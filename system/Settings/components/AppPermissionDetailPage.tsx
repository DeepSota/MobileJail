import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { SettingsHeader } from './SettingsHeader';
import { PreferenceCategory } from './PreferenceCategory';
import { SettingsIcon } from './SettingsIcon';
import { AppIcon } from '../../../os/components/AppIcon';
import { getAppManifest, getLocalizedAppName, isValidAppId } from '../../../os/data/appRegistry';
import { PermissionService } from '../../../os/PermissionService';
import {
  getPermissionDisplayName,
  getPermissionGroup,
  PERMISSION_GROUPS,
  type PermissionId,
  type PermissionStatus,
} from '../../../os/permissions';
import type { AppId } from '../../../os/types';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsGestures } from '../hooks/useSettingsGestures';
import { IcNavForward } from '../res/icons';

// ── Permission group row ────────────────────────────────────────

const PermissionGroupRow: React.FC<{
  iconName: string;
  title: string;
  summary: string;
  showDivider: boolean;
  rowProps?: React.HTMLAttributes<HTMLDivElement>;
}> = ({ iconName, title, summary, showDivider, rowProps }) => (
  <div>
    <div
      className="flex min-h-(--app-preference-item-min-height) items-center px-4 py-3.5 active:bg-gray-50"
      {...rowProps}
    >
      <div className="mr-3 flex-shrink-0">
        <SettingsIcon name={iconName} size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-tight text-app-text">{title}</div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-tight text-gray-400">{summary}</div>
      </div>
      <IcNavForward size={16} className="ml-2 flex-shrink-0 text-gray-300" />
    </div>
    {showDivider ? <div className="ml-[60px] mr-4 h-px bg-gray-100" /> : null}
  </div>
);

// ── Single permission detail overlay (Android-style radio options) ──

type PermissionChoice = 'allow' | 'deny' | 'ask';

const CHOICE_LABELS: Record<PermissionChoice, { zh: string; en: string }> = {
  allow: { zh: '允许', en: 'Allow' },
  deny: { zh: '不允许', en: "Don't allow" },
  ask: { zh: '每次询问', en: 'Ask every time' },
};

const PermissionDetailPanel: React.FC<{
  appId: AppId;
  groupId: string;
  groupTitle: string;
  groupDescription: string;
  iconName: string;
  permissions: PermissionId[];
  onClose: () => void;
}> = ({ appId, groupId, groupTitle, groupDescription, iconName, permissions, onClose }) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindBack } = useSettingsGestures();
  const isZh = !navigator.language?.startsWith('en');

  // Subscribe to permission changes
  useSyncExternalStore(
    (onChange) => PermissionService.subscribe(() => onChange()),
    () => PermissionService.getState(),
  );

  // Determine current status
  const statuses = PermissionService.checkPermissions(appId, permissions);
  const allGranted = Object.values(statuses).every((s) => s === 'granted');
  const allDenied = Object.values(statuses).every(
    (s) => s === 'denied' || s === 'denied_forever',
  );
  const hasAnyNotRequested = Object.values(statuses).some((s) => s === 'not_requested');

  const currentChoice: PermissionChoice = allGranted
    ? 'allow'
    : allDenied
      ? 'deny'
      : hasAnyNotRequested
        ? 'ask'
        : 'allow';

  const [selected, setSelected] = useState<PermissionChoice>(currentChoice);

  const apply = () => {
    if (selected === 'allow') {
      for (const permId of permissions) {
        PermissionService.grantPermission(appId, permId);
      }
    } else if (selected === 'deny') {
      for (const permId of permissions) {
        PermissionService.revokePermission(appId, permId);
      }
    } else {
      // "Ask every time" — reset to not_requested so next runtime request will prompt
      for (const permId of permissions) {
        const cur = PermissionService.checkPermission(appId, permId);
        if (cur === 'granted') {
          PermissionService.revokePermission(appId, permId);
        }
        // denied / denied_forever both mean "won't auto-grant" — leave as-is for "ask" semantics
      }
    }
    onClose();
  };

  const choices: PermissionChoice[] = ['allow', 'deny', 'ask'];

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={groupTitle} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {/* Description */}
        <div className="px-5 py-4">
          <p className="text-[14px] leading-relaxed text-gray-500">{groupDescription}</p>
        </div>

        {/* Radio options */}
        <div className="mx-4 bg-app-surface rounded-2xl overflow-hidden">
          {choices.map((choice, idx) => {
            const label = isZh ? CHOICE_LABELS[choice].zh : CHOICE_LABELS[choice].en;
            const isSelected = selected === choice;
            return (
              <React.Fragment key={choice}>
                {idx > 0 ? <div className="h-px bg-black/5 ml-5" /> : null}
                <button
                  type="button"
                  className="w-full px-5 py-4 flex items-center gap-3 active:bg-black/5 text-left"
                  onClick={() => setSelected(choice)}
                >
                  {/* Radio circle */}
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'border-emerald-500' : 'border-gray-300'
                    }`}
                  >
                    {isSelected && (
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    )}
                  </div>
                  <span className="text-[15px] text-app-text">{label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Sub-permissions list under this group */}
        {permissions.length > 1 && (
          <div className="mt-4 mx-4">
            <div className="px-1 py-2 text-[12px] text-gray-400 font-medium">
              {isZh ? '包含的权限' : 'Included permissions'}
            </div>
            <div className="bg-app-surface rounded-2xl overflow-hidden">
              {permissions.map((permId, idx) => {
                const permStatus = PermissionService.checkPermission(appId, permId);
                const statusLabel =
                  permStatus === 'granted'
                    ? isZh
                      ? '已允许'
                      : 'Allowed'
                    : permStatus === 'denied' || permStatus === 'denied_forever'
                      ? isZh
                        ? '已拒绝'
                        : 'Denied'
                      : isZh
                        ? '未请求'
                        : 'Not requested';
                return (
                  <React.Fragment key={permId}>
                    {idx > 0 ? <div className="h-px bg-black/5 ml-5" /> : null}
                    <div className="px-5 py-3.5 flex items-center justify-between">
                      <span className="text-[14px] text-app-text">
                        {getPermissionDisplayName(permId)}
                      </span>
                      <span className="text-[12px] text-gray-400">{statusLabel}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Done button */}
        <div className="mx-4 mt-6">
          <button
            type="button"
            className="w-full h-12 rounded-2xl bg-emerald-500 text-white font-semibold text-[15px] flex items-center justify-center active:bg-emerald-600"
            onClick={apply}
          >
            {isZh ? '完成' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main detail page (list of permission groups) ───────────────

export const AppPermissionDetailPage: React.FC<{ appId: string }> = ({ appId }) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useSettingsGestures();
  const isZh = !navigator.language?.startsWith('en');

  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useSyncExternalStore(
    (onChange) => PermissionService.subscribe(() => onChange()),
    () => PermissionService.getState(),
  );

  const manifest = isValidAppId(appId) ? getAppManifest(appId as AppId) : undefined;
  const resolvedAppId = isValidAppId(appId) ? (appId as AppId) : null;

  const declared = useMemo(
    () => (resolvedAppId ? PermissionService.getDeclaredPermissions(resolvedAppId) : []),
    [resolvedAppId],
  );

  const grouped = useMemo(() => {
    const orderMap = new Map(PERMISSION_GROUPS.map((group, idx) => [group.id, idx]));
    const groups = new Map<
      string,
      {
        id: string;
        iconName: string;
        title: string;
        description: string;
        permissions: PermissionId[];
      }
    >();

    for (const permissionId of declared) {
      const group = getPermissionGroup(permissionId);
      if (!group) {
        const fallbackId = `RAW__${permissionId}`;
        if (!groups.has(fallbackId)) {
          groups.set(fallbackId, {
            id: fallbackId,
            iconName: 'ic_privacy_settings',
            title: getPermissionDisplayName(permissionId),
            description: getPermissionDisplayName(permissionId),
            permissions: [],
          });
        }
        groups.get(fallbackId)!.permissions.push(permissionId);
        continue;
      }

      if (!groups.has(group.id)) {
        groups.set(group.id, {
          id: group.id,
          iconName: group.iconName,
          title: group.displayName,
          description: group.description,
          permissions: [],
        });
      }
      groups.get(group.id)!.permissions.push(permissionId);
    }

    return Array.from(groups.values()).sort((a, b) => {
      const ao = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const bo = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });
  }, [declared]);

  // If a group detail panel is active, render it
  if (activeGroup) {
    const g = grouped.find((g) => g.id === activeGroup);
    if (g && resolvedAppId) {
      return (
        <PermissionDetailPanel
          appId={resolvedAppId}
          groupId={g.id}
          groupTitle={g.title}
          groupDescription={g.description}
          iconName={g.iconName}
          permissions={g.permissions}
          onClose={() => setActiveGroup(null)}
        />
      );
    }
  }

  if (!manifest || !resolvedAppId) {
    return (
      <div className="flex h-full flex-col bg-app-bg">
        <SettingsHeader title={s.app_permissions} />
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="text-center text-gray-400">
            <div className="mb-1 text-[14px] font-medium text-app-text-muted">
              {s.app_not_found}
            </div>
            <div className="text-[12px] text-gray-400">
              {s.app_id_label}
              {appId || '—'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Build summary for each group
  const getGroupSummary = (group: (typeof grouped)[number]): string => {
    const statuses = PermissionService.checkPermissions(resolvedAppId, group.permissions);
    const granted = Object.values(statuses).filter((s) => s === 'granted').length;
    const total = group.permissions.length;
    if (granted === total) return isZh ? '已允许' : 'Allowed';
    if (granted === 0) return isZh ? '不允许' : 'Not allowed';
    return isZh ? `${granted}/${total} 已允许` : `${granted}/${total} allowed`;
  };

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={s.app_permissions} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {/* App header */}
        <div className="flex items-center gap-3 px-4 pb-2 pt-3">
          <AppIcon manifest={manifest} size={42} radius={12} showShadow />
          <div className="min-w-0">
            <div className="truncate text-[18px] font-semibold text-app-text">
              {getLocalizedAppName(resolvedAppId)}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-gray-400">
              {manifest.packageName}
            </div>
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-gray-400">
            {s.no_permissions_declared_for_app}
          </div>
        ) : (
          <PreferenceCategory title={s.permissions}>
            {grouped.map((group, index) => (
              <PermissionGroupRow
                key={group.id}
                iconName={group.iconName}
                title={group.title}
                summary={getGroupSummary(group)}
                showDivider={index < grouped.length - 1}
                rowProps={bindTap<HTMLDivElement>(
                  { kind: 'action', id: 'settings.permission.group.open' },
                  {
                    params: { appId: resolvedAppId, groupId: group.id },
                    onTrigger: () => setActiveGroup(group.id),
                  },
                )}
              />
            ))}
          </PreferenceCategory>
        )}
      </div>
    </div>
  );
};

export default AppPermissionDetailPage;