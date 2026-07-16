import { IcLauncher } from './res/icons';
import type { AppManifest } from '@/os/types/manifest';
import { PERMISSIONS } from '@/os/permissions';

export const manifest: AppManifest = {
  id: 'file_manager',
  packageName: 'com.android.fileexplorer',
  displayName: '文件',
  displayNameEn: 'Files',
  version: '1.0.0',
  versionCode: 1,
  type: 'system',
  icon: IcLauncher,
  iconBackground: '#f59e0b',
  iconForeground: '#ffffff',
  designViewportWidth: 412,
  theme: {
    colors: {
      primary: '#3b82f6',
      primaryDark: '#2563eb',
      background: '#f3f4f6',
      surface: '#ffffff',
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      border: '#e5e7eb',
      statusBarForeground: 'dark',
      navigationBarForeground: 'dark',
    },
  },
  permissions: [
    PERMISSIONS.READ_EXTERNAL_STORAGE,
    PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  ],
  intentFilters: [
    { action: 'ACTION_VIEW', type: 'application/pdf', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'text/plain', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'application/msword', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'application/vnd.ms-excel', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'application/vnd.ms-powerpoint', route: '/viewer' },
    { action: 'ACTION_VIEW', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', route: '/viewer' },
    {
      action: 'ACTION_VIEW',
      type: 'inode/directory',
      route: '/',
      description: '打开 FileManager；调用方通过 intent.route 指定具体子页（如 /category/images），缺省落在根目录',
    },
  ],
  queries: [
    { action: 'ACTION_VIEW', type: 'image/*' },
    { action: 'ACTION_SEND', type: '*/*' },
    { action: 'ACTION_SEND', type: 'image/*' },
    { action: 'ACTION_SEND', type: 'application/*' },
    { action: 'ACTION_SEND_MULTIPLE', type: '*/*' },
  ],
};
