import { IcLauncher } from './res/icons';
import type { AppManifest } from '@/os/types/manifest';
import { PERMISSIONS } from '@/os/permissions';

export const manifest: AppManifest = {
  id: 'x',
  packageName: 'com.twitter.android',
  displayName: 'X',
  displayNameEn: 'X',
  version: '11.65.0',
  versionCode: 1,
  type: 'plugin',
  icon: IcLauncher,
  iconBackground: '#000000',
  iconForeground: '#ffffff',
  designViewportWidth: 412,
  theme: {
    colors: {
      primary: '#1d9bf0',
      background: '#ffffff',
      surface: '#f9fafb',
      textPrimary: '#0f1419',
      textSecondary: '#536471',
      border: '#eff3f4',
      statusBarForeground: 'dark',
      navigationBarForeground: 'dark',
    },
  },
  permissions: [
    PERMISSIONS.CAMERA,
    PERMISSIONS.READ_EXTERNAL_STORAGE,
    PERMISSIONS.ACCESS_FINE_LOCATION,
  ],
  intentFilters: [
    {
      action: 'ACTION_SEND',
      type: 'text/plain',
      route: '/compose',
      shareKind: 'text',
      description: '接收文本分享',
    },
    {
      action: 'ACTION_SEND',
      type: 'image/*',
      route: '/share',
      shareKind: 'files',
      description: '通过私信发送图片附件',
    },
    {
      action: 'ACTION_SEND',
      type: 'application/*',
      route: '/share',
      shareKind: 'files',
      description: '通过私信发送文档附件',
    },
    {
      action: 'ACTION_SEND',
      type: '*/*',
      route: '/share',
      shareKind: 'files',
      description: '通过私信发送任意单个附件',
    },
    {
      action: 'ACTION_SEND_MULTIPLE',
      type: '*/*',
      route: '/share',
      shareKind: 'files',
      description: '通过私信发送多个附件',
    },
  ],
  queries: [
    { action: 'ACTION_SEND', type: 'text/plain' },
    { action: 'ACTION_SEND', type: 'image/*' },
    { action: 'ACTION_SEND', type: 'application/*' },
    { action: 'ACTION_VIEW', type: '*/*' },
  ],
};
