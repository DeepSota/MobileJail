import { IcLauncher } from './res/icons';
import type { AppManifest } from '@/os/types/manifest';
import { PERMISSIONS } from '@/os/permissions';

export const manifest: AppManifest = {
  id: 'mail',
  packageName: 'com.sim.mail',
  displayName: '邮件',
  displayNameEn: 'Mail',
  version: '1.0.0',
  versionCode: 1,
  type: 'system',
  icon: IcLauncher,
  iconBackground: '#1E88E5',
  iconForeground: '#ffffff',
  designViewportWidth: 360,
  theme: {
    colors: {
      primary: '#3482FF',
      primaryDark: '#2563EB',
      background: '#F5F5F5',
      surface: '#FFFFFF',
      textPrimary: '#111827',
      textSecondary: '#6B7280',
      border: '#E5E7EB',
      statusBarForeground: 'dark',
      navigationBarForeground: 'dark',
    },
  },
  permissions: [
    PERMISSIONS.READ_CONTACTS,
    PERMISSIONS.READ_EXTERNAL_STORAGE,
    PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  ],
  intentFilters: [
    {
      action: 'ACTION_VIEW',
      scheme: 'mailto',
      route: '/compose',
      description: '通过 mailto: 链接发邮件 — 调用方需要传 { newTask: true } 让 Mail 进入独立 Task',
    },
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
      route: '/compose',
      shareKind: 'files',
      description: '接收图片分享',
    },
    {
      action: 'ACTION_SEND',
      type: 'application/*',
      route: '/compose',
      shareKind: 'files',
      description: '接收文档分享',
    },
    {
      action: 'ACTION_SEND',
      type: '*/*',
      route: '/compose',
      shareKind: 'files',
      description: '接收任意单个附件',
    },
    {
      action: 'ACTION_SEND_MULTIPLE',
      type: '*/*',
      route: '/compose',
      shareKind: 'files',
      description: '接收多个附件',
    },
  ],
  queries: [
    { action: 'ACTION_PICK', type: 'vnd.android.cursor.dir/contact' },
    { action: 'ACTION_VIEW', scheme: 'tel' },
    { action: 'ACTION_SEND', type: 'image/*' },
    { action: 'ACTION_VIEW', type: '*/*' },
  ],
};
