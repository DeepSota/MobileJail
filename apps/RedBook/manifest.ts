import { IcLauncher } from './res/icons';
import type { AppManifest } from '@/os/types/manifest';
import { PERMISSIONS } from '@/os/permissions';

export const manifest: AppManifest = {
  id: 'redbook',
  packageName: 'com.xingin.xhs',
  displayName: '小红书',
  displayNameEn: 'RedNote',
  version: '9.15.0',
  versionCode: 1,
  type: 'plugin',
  icon: IcLauncher,
  iconBackground: '#ff2442',
  iconForeground: '#ffffff',
  designViewportWidth: 412,
  theme: {
    colors: {
      primary: '#ff2442',
      background: '#ffffff',
      surface: '#ffffff',
      textPrimary: '#333333',
      textSecondary: '#999999',
      border: '#f5f5f5',
      statusBarForeground: 'dark',
      navigationBarForeground: 'dark',
    },
  },
  permissions: [
    PERMISSIONS.CAMERA,
    PERMISSIONS.RECORD_AUDIO,
    PERMISSIONS.READ_EXTERNAL_STORAGE,
    PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    PERMISSIONS.ACCESS_FINE_LOCATION,
  ],
  intentFilters: [
    {
      action: 'ACTION_SEND',
      type: 'text/plain',
      route: '/publish/text',
      shareKind: 'text',
      description: '接收文本分享',
    },
    {
      action: 'ACTION_SEND',
      type: 'image/*',
      route: '/share',
      shareKind: 'files',
      description: '发送图片给小红书好友',
    },
    {
      action: 'ACTION_SEND',
      type: 'application/*',
      route: '/share',
      shareKind: 'files',
      description: '发送文档给小红书好友',
    },
    {
      action: 'ACTION_SEND',
      type: '*/*',
      route: '/share',
      shareKind: 'files',
      description: '发送任意单个文件给小红书好友',
    },
    {
      action: 'ACTION_SEND_MULTIPLE',
      type: '*/*',
      route: '/share',
      shareKind: 'files',
      description: '发送多个图片或文件给小红书好友',
    },
  ],
  queries: [
    { action: 'ACTION_SEND', type: 'text/plain' },
    { action: 'ACTION_SEND', type: 'image/*' },
    { action: 'ACTION_SEND', type: 'application/*' },
    { action: 'ACTION_VIEW', type: '*/*' },
  ],
};
