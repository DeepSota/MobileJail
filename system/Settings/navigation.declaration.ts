/**
 * Settings 导航声明（用于静态分析 / 任务生成）
 *
 * 注意：
 * - Settings 历史上使用过自定义结构的 navigation.declaration.ts，脚本无法识别。
 * - 这里统一为标准 NAVIGATION_DECLARATION（与其它 App 一致），以便 `build_nav_artifacts.mjs` 工作。
 */

const MAIN_SCROLL = [
  { name: 'main', direction: 'vertical', description: '页面主内容区' },
] as const;

const PAGE_SCROLLS = [
  ...MAIN_SCROLL,
  { name: 'options', direction: 'vertical', description: '设置选项弹层' },
] as const;

export const NAVIGATION_DECLARATION = {
  app: 'settings',
  routes: [
    {
      path: '/',
      component: 'SettingsMainPage',
      params: {},
      entryPoint: 'home',
      scrollContainers: MAIN_SCROLL,
      uiStates: [{ id: 'settings.main.base', search: {}, description: '设置首页' }],
      queryParams: {},
      description: '设置首页',
    },
    {
      path: '/search',
      component: 'SettingsSearchPage',
      params: {},
      entryPoint: 'none',
      scrollContainers: MAIN_SCROLL,
      uiStates: [
        {
          id: 'settings.search.base',
          search: {},
          description: '设置搜索页',
          actions: [
            {
              id: 'settings.search.clear',
              label: '清空设置搜索',
              behavior: 'other',
            },
            {
              id: 'settings.search.query.input',
              label: '输入设置搜索关键词',
              behavior: 'input',
              paramsSchema: { value: 'string' },
            },
          ],
        },
      ],
      queryParams: { q: 'string' },
      description: '设置搜索页',
    },
    {
      path: '/page/:pageId',
      component: 'PreferenceScreenPage',
      params: { pageId: 'string' },
      entryPoint: 'deepLink',
      scrollContainers: PAGE_SCROLLS,
      uiStates: [
        {
          id: 'settings.page.base',
          search: {},
          description: '设置详情页',
          actions: [
            {
              id: 'settings.preference.toggle',
              label: '切换设置开关',
              behavior: 'toggle',
              scope: 'item',
              paramsSchema: { key: 'string', to: 'boolean' },
            },
            {
              id: 'settings.preference.slider.input',
              label: '调整设置滑杆',
              behavior: 'input',
              scope: 'item',
              paramsSchema: { key: 'string', value: 'number' },
            },
            {
              id: 'settings.wifi.enabled.toggle',
              label: '开启或关闭 WLAN',
              behavior: 'toggle',
            },
            {
              id: 'settings.wifi.network.connect',
              label: '连接或断开 WLAN 网络',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { ssid: 'string' },
            },
            {
              id: 'settings.bluetooth.enabled.toggle',
              label: '开启或关闭蓝牙',
              behavior: 'toggle',
            },
            {
              id: 'settings.bluetooth.device.connect',
              label: '配对、连接或断开蓝牙设备',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { mac: 'string' },
            },
            {
              id: 'settings.storage.category.open',
              label: '在文件管理中打开存储分类',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { category: 'string' },
            },
            {
              id: 'settings.storage.refresh',
              label: '刷新存储空间统计',
              behavior: 'other',
            },
            {
              id: 'settings.language.option.select.value',
              label: '选择系统语言',
              behavior: 'select',
              scope: 'item',
              paramsSchema: { language: 'string' },
            },
            {
              id: 'settings.sound.mode.select.value',
              label: '选择响铃模式',
              behavior: 'select',
              scope: 'item',
              paramsSchema: { mode: 'string' },
            },
            {
              id: 'settings.permission.group.toggle',
              label: '授予或撤销应用权限组',
              behavior: 'toggle',
              scope: 'item',
              paramsSchema: { appId: 'string', groupId: 'string', to: 'boolean' },
            },
            {
              id: 'settings.permission.group.open',
              label: '打开应用权限组详情',
              behavior: 'navigate',
              scope: 'item',
              paramsSchema: { appId: 'string', groupId: 'string' },
            },
            {
              id: 'settings.notification.preference.toggle',
              label: '切换应用通知设置',
              behavior: 'toggle',
              scope: 'item',
              paramsSchema: { key: 'string', to: 'boolean' },
            },
            {
              id: 'settings.notification.clear',
              label: '清除应用通知',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { appId: 'string' },
            },
            {
              id: 'settings.notification.test.submit',
              label: '发送测试通知',
              behavior: 'submit',
              scope: 'item',
              paramsSchema: { appId: 'string' },
            },
            {
              id: 'settings.wifi.saved.autoJoin.toggle',
              label: '切换 WLAN 自动加入',
              behavior: 'toggle',
              scope: 'item',
              paramsSchema: { ssid: 'string', to: 'boolean' },
            },
            {
              id: 'settings.wifi.saved.connect',
              label: '连接已保存 WLAN',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { ssid: 'string' },
            },
            {
              id: 'settings.wifi.saved.forget',
              label: '忘记已保存 WLAN',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { ssid: 'string' },
            },
            {
              id: 'settings.info.copy',
              label: '复制设备信息',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { key: 'string' },
            },
            {
              id: 'settings.themeStore.open',
              label: '在主题商店中打开个性化资源',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { key: 'string' },
            },
            {
              id: 'settings.app.cache.clear',
              label: '清除应用真实缓存目录内容',
              behavior: 'delete',
              scope: 'item',
              paramsSchema: { appId: 'string' },
            },
            {
              id: 'settings.app.defaultOpen.set',
              label: '设置文件类型的默认打开应用',
              behavior: 'other',
              scope: 'item',
              paramsSchema: { appId: 'string', category: 'string' },
            },
          ],
        },
        {
          id: 'settings.page.dialog.list',
          search: { dialog: 'list' },
          description: '列表设置选项弹层',
          actions: [
            {
              id: 'settings.preference.option.select.value',
              label: '选择列表设置值',
              behavior: 'select',
              scope: 'item',
              paramsSchema: { key: 'string', value: 'string' },
            },
          ],
        },
        {
          id: 'settings.page.dialog.value',
          search: { dialog: 'value' },
          description: '文本设置输入弹窗',
          actions: [
            {
              id: 'settings.preference.value.submit',
              label: '保存文本设置',
              behavior: 'submit',
              scope: 'item',
              paramsSchema: { key: 'string', value: 'string' },
            },
            {
              id: 'settings.security.pin.submit',
              label: '提交锁屏 PIN 安全操作',
              behavior: 'submit',
              paramsSchema: { operation: 'string' },
            },
            {
              id: 'settings.datetime.manual.submit',
              label: '保存手动日期和时间',
              behavior: 'submit',
              paramsSchema: { value: 'string' },
            },
          ],
        },
        {
          id: 'settings.page.dialog.wifiPassword',
          search: { dialog: 'wifiPassword' },
          description: 'WLAN 密码输入弹窗',
          actions: [
            {
              id: 'settings.wifi.network.password.submit',
              label: '输入密码并连接 WLAN',
              behavior: 'submit',
              scope: 'item',
              paramsSchema: { ssid: 'string', password: 'string' },
            },
            {
              id: 'settings.wifi.saved.add.submit',
              label: '保存 WLAN 网络',
              behavior: 'submit',
              scope: 'item',
              paramsSchema: { ssid: 'string', password: 'string' },
            },
          ],
        },
        {
          id: 'settings.page.dialog.wifiSsid',
          search: { dialog: 'wifiSsid' },
          description: 'WLAN 网络名称输入弹窗',
          actions: [
            {
              id: 'settings.wifi.saved.ssid.submit',
              label: '输入 WLAN 网络名称',
              behavior: 'submit',
              paramsSchema: { ssid: 'string' },
            },
          ],
        },
        {
          id: 'settings.page.dialog.bluetoothName',
          search: { dialog: 'bluetoothName' },
          description: '蓝牙设备名称输入弹窗',
          actions: [
            {
              id: 'settings.bluetooth.name.submit',
              label: '保存蓝牙设备名称',
              behavior: 'submit',
              paramsSchema: { value: 'string' },
            },
          ],
        },
      ],
      queryParams: { dialogKey: 'string' },
      description: '设置详情页',
    },
  ],
  transitions: [
    {
      id: 'search.open',
      from: '/',
      to: '/search',
      search: {},
      searchParams: {},
      mode: 'push',
      params: {},
      label: '打开设置搜索',
      ui: { placement: 'topbar', icon: 'search', gesture: 'tap' },
    },
    {
      id: 'page.open',
      from: ['/', '/search', { path: '/page/:pageId', search: { dialog: null } }],
      to: '/page/:pageId',
      search: {},
      searchParams: {},
      mode: 'push',
      params: { pageId: 'string' },
      label: '打开设置项详情',
      ui: { placement: 'content', icon: 'page', gesture: 'tap' },
    },
    {
      id: 'dialog.open',
      from: { path: '/page/:pageId', search: { dialog: null } },
      to: '/page/:pageId',
      search: {},
      searchParams: { dialog: 'string', dialogKey: 'string' },
      mode: 'push',
      params: { pageId: 'string' },
      label: '打开设置弹层',
      ui: { placement: 'content', icon: 'dialog', gesture: 'tap' },
    },
    {
      id: 'wifi.password.open',
      from: { path: '/page/:pageId', search: { dialog: 'wifiSsid' } },
      to: '/page/:pageId',
      search: { dialog: 'wifiPassword' },
      searchParams: { dialogKey: 'string' },
      mode: 'replace',
      params: { pageId: 'string' },
      label: '继续输入 WLAN 密码',
      ui: { placement: 'content', icon: 'password', gesture: 'tap' },
    },
    {
      id: 'security.pin.step',
      from: { path: '/page/:pageId', search: { dialog: 'value' } },
      to: '/page/:pageId',
      search: { dialog: 'value' },
      searchParams: { dialogKey: 'string' },
      mode: 'replace',
      params: { pageId: 'string' },
      label: '继续锁屏 PIN 安全验证步骤',
      ui: { placement: 'dialog', icon: 'password', gesture: 'tap' },
    },
  ],
  capabilities: {
    historyBack: true,
  },
} as const;

export type TransitionId = typeof NAVIGATION_DECLARATION.transitions[number]['id'];
