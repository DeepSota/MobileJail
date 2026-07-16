import { IcLauncher } from './res/icons';
import type { AppManifest } from '@/os/types/manifest';
import { PERMISSIONS } from '@/os/permissions';

export const manifest: AppManifest = {
  id: 'tencent_meeting',
  packageName: 'com.tencent.wemeet.app',
  displayName: '腾讯会议',
  displayNameEn: 'Tencent Meeting',
  version: '3.41.1.426',
  versionCode: 1,
  type: 'plugin',
  icon: IcLauncher,
  iconBackground: '#ffffff',
  iconForeground: '#006eff',
  designViewportWidth: 412,
  theme: {
    colors: {
      primary: '#006eff',
      background: '#f5f6f7',
      surface: '#ffffff',
      textPrimary: '#333333',
      textSecondary: '#666666',
      border: '#e5e7eb',
      statusBarForeground: 'dark',
      navigationBarForeground: 'dark',
    },
  },
  permissions: [
    PERMISSIONS.CAMERA,
    PERMISSIONS.RECORD_AUDIO,
    PERMISSIONS.READ_CONTACTS,
  ],
  intentFilters: [
    {
      action: 'ACTION_SEND',
      type: 'image/*',
      route: '/share-files',
      shareKind: 'files',
      availabilityKey: 'tencent_meeting.active_meeting',
      description: '发送图片到当前会议',
    },
    {
      action: 'ACTION_SEND',
      type: 'application/*',
      route: '/share-files',
      shareKind: 'files',
      availabilityKey: 'tencent_meeting.active_meeting',
      description: '发送文件到当前会议',
    },
    {
      action: 'ACTION_SEND',
      type: '*/*',
      route: '/share-files',
      shareKind: 'files',
      availabilityKey: 'tencent_meeting.active_meeting',
      description: '发送任意单个文件到当前会议',
    },
    {
      action: 'ACTION_SEND_MULTIPLE',
      type: '*/*',
      route: '/share-files',
      shareKind: 'files',
      availabilityKey: 'tencent_meeting.active_meeting',
      description: '发送多个图片或文件到当前会议',
    },
  ],
  queries: [
    { action: 'ACTION_VIEW', type: 'image/*' },
    { action: 'ACTION_VIEW', type: 'application/*' },
    { action: 'ACTION_VIEW', type: 'text/plain' },
  ],
};
