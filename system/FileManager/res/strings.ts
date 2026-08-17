/**
 * FileManager 字符串资源 — 对应 AOSP res/values/strings.xml
 */
export const strings = {
  app_name: '文件',

  // ============================================================================
  // Tab bar
  // ============================================================================
  tab_recent: '最近',
  tab_browse: '浏览',
  tab_cloud: '云盘',

  // ============================================================================
  // Browse home page — categories
  // ============================================================================
  section_file_type: '文件类型',
  section_more: '更多',
  category_documents: '文档',
  category_images: '图片',
  category_videos: '视频',
  category_audio: '音乐',
  category_audio_alt: '音频',
  category_files: '文件',

  // ============================================================================
  // Browse home page — storage
  // ============================================================================
  section_internal_storage: '内部存储',
  internal_storage_device: '内部存储设备',
  item_count_suffix: '项',

  // ============================================================================
  // Folder aliases
  // ============================================================================
  alias_android: '安卓',
  alias_backups: 'ES浏览器备份',
  alias_baidu_netdisk: '百度云',
  alias_dcim: '相册',

  // ============================================================================
  // Selection mode
  // ============================================================================
  selected_count: '已选择${count}项',
  select_items_prompt: '请选择项目',
  select_single_item_required: '请只选择一个项目',

  // ============================================================================
  // Toolbar icon labels
  // ============================================================================
  toolbar_search: '搜索',
  toolbar_filter: '筛选',
  toolbar_more: '更多',
  toolbar_new_folder: '新建文件夹',

  // ============================================================================
  // Bottom action bar
  // ============================================================================
  action_send: '发送',
  action_move: '移动',
  action_delete: '删除',
  action_more: '更多',

  // ============================================================================
  // Action menu options
  // ============================================================================
  menu_copy: '复制',
  menu_set_private: '设为私密',
  menu_favorite: '收藏',
  menu_rename: '重命名',
  menu_compress: '压缩',
  menu_add_to_widget: '添加到小部件',
  menu_open_with_other_app: '用其他应用打开',
  menu_details: '详情',

  // ============================================================================
  // Dialog — common buttons
  // ============================================================================
  dialog_confirm: '确定',
  dialog_cancel: '取消',
  dialog_got_it: '知道了',

  // ============================================================================
  // Dialog — delete confirmation
  // ============================================================================
  delete_title: '删除',
  delete_confirm_selected: '确定要删除选中的 ${count} 个项目吗？',
  delete_confirm_folder: '删除文件夹会同时删除该文件夹下的所有文件。确定要删除吗？',
  delete_confirm_file: '确定要删除该文件吗？',

  // ============================================================================
  // Dialog — rename
  // ============================================================================
  rename_title: '重命名',

  // ============================================================================
  // Dialog — new folder
  // ============================================================================
  new_folder_title: '新建文件夹',
  new_folder_placeholder: '文件夹名称',
  new_folder_confirm: '创建',

  // ============================================================================
  // Transfer sheet
  // ============================================================================
  transfer_copy_title: '复制到...',
  transfer_move_title: '移动到...',
  transfer_new_folder: '新建文件夹',
  transfer_copy_success: '复制成功',
  transfer_copy_failed: '复制失败',
  transfer_move_success: '移动成功',
  transfer_move_failed: '移动失败',

  // ============================================================================
  // File details dialog
  // ============================================================================
  detail_location: '位置：',
  detail_size: '大小：',
  detail_time: '时间：',
  detail_readable: '可读：',
  detail_writable: '可写：',
  detail_hidden: '隐藏：',
  detail_yes: '是',
  detail_no: '否',

  // ============================================================================
  // Toast messages
  // ============================================================================
  toast_deleted_items: '已删除 ${count} 个项目',
  toast_rename_success: '重命名成功',
  toast_rename_failed: '重命名失败',
  toast_paste_success: '粘贴成功',
  toast_paste_failed: '粘贴失败',
  toast_folder_exists: '文件夹已存在',
  toast_folder_created: '文件夹已创建',
  toast_set_private: '已设为私密',
  toast_added_to_favorites: '已添加到收藏',
  toast_send_no_image: '没有可发送的文件',
  toast_compressing: '开始压缩...',
  toast_added: '已添加',
  toast_searching_apps: '正在查找应用...',

  // ============================================================================
  // Clipboard
  // ============================================================================
  clipboard_copied: '已复制',
  clipboard_cut: '已剪切',
  clipboard_item_count: '${count} 项',
  clipboard_paste: '粘贴',

  // ============================================================================
  // Folder page — empty state
  // ============================================================================
  folder_empty: '文件夹为空',

  // ============================================================================
  // Text preview page
  // ============================================================================
  text_preview_no_file: '未选择文件',
  text_preview_loading: '正在打开...',
  text_preview_failed: '无法打开这个文本文件',
  text_preview_empty: '（空文件）',

  // ============================================================================
  // PDF preview page
  // ============================================================================
  pdf_preview_no_file: '未选择文件',
  pdf_preview_loading: '正在打开...',
  pdf_preview_failed: '无法打开这个 PDF 文件',

  // ============================================================================
  // Unified document viewer
  // ============================================================================
  viewer_no_file: '未选择文件',
  viewer_back: '返回',
  viewer_share: '分享',
  viewer_pages: '页面',
  viewer_done: '完成',
  viewer_opening: '正在打开文件…',
  viewer_rendering: '正在生成页面…',
  viewer_rendering_spreadsheet: '正在读取工作簿…',
  viewer_converting_office: '正在转换 Office 文档…',
  viewer_converting_office_hint: '首次打开可能需要几秒钟',
  viewer_search_placeholder: '查找文档内容',
  viewer_search_no_results: '未找到匹配内容',
  viewer_search_pages_suffix: ' 页包含匹配内容',
  viewer_search_matches_suffix: ' 处匹配',
  viewer_search_cells_suffix: ' 个单元格匹配',
  viewer_encoding_label: '编码：',
  viewer_wrap_on: '自动换行',
  viewer_wrap_off: '不换行',
  viewer_name_box_label: '名称框',
  viewer_formula_bar_label: '公式栏',
  viewer_zoom_out: '缩小',
  viewer_zoom_in: '放大',
  viewer_previous_page: '上一页',
  viewer_next_page: '下一页',
  viewer_pdf_page_prefix: 'PDF 第 ',
  viewer_pdf_page_suffix: ' 页',
  viewer_empty_sheet: '当前工作表为空',
  viewer_retry: '重试',
  viewer_cannot_open: '无法打开此文件',
  viewer_no_compatible_app: '暂无可用应用打开这种文件',
  viewer_read_failed: '无法读取文件',
  viewer_file_missing_hint: '文件可能已被移动、重命名或删除',
  viewer_error_pdf: 'PDF 文件无法显示',
  viewer_error_spreadsheet: '工作簿无法显示',
  viewer_office_failed: 'Office 文档预览失败',
  viewer_error_generic: '文档预览时遇到问题',
  viewer_error_empty_title: '文件为空',
  viewer_error_empty: '此文件没有可显示的内容',
  viewer_error_too_large_title: '文件过大',
  viewer_error_too_large: '文件超过此格式的本机预览限制',
  viewer_error_password_title: '文件受密码保护',
  viewer_error_password: '请移除文档密码后再尝试预览',
  viewer_error_damaged: '文件可能已损坏或格式与扩展名不匹配',
  viewer_error_busy: '预览服务正忙，请稍后重试',
  viewer_error_timeout: '文档转换超时，请重试',
  viewer_error_service_unavailable: '文档预览服务暂时不可用',
  viewer_rendering_docx: '正在渲染 Word 文档…',
  viewer_rendering_pptx: '正在渲染演示文稿…',
  viewer_error_docx: 'Word 文档无法显示',
  viewer_error_pptx: '演示文稿无法显示',
  viewer_error_legacy_format: '旧版 Office 格式暂不支持本机预览，请转换为 .docx 或 .pptx',
  viewer_edit: '编辑',
  viewer_save: '保存',
  viewer_saving: '保存中…',
  viewer_save_success: '已保存',
  viewer_save_failed: '保存失败',
  viewer_pptx_slide_prefix: '幻灯片 ',
  viewer_pptx_slide_suffix: '',
  unsupported_file_close: '关闭',
  unsupported_file_message: '暂无可用应用打开此文件',

  // ============================================================================
  // Category page — empty state
  // ============================================================================
  category_empty_prefix: '暂无',
  category_file_count: '${count} 个文件',

  // ============================================================================
  // Cloud page
  // ============================================================================
  cloud_not_connected: '云盘暂未连接',

  // ============================================================================
  // Recent page — date groups
  // ============================================================================
  date_today: '今天',
  date_yesterday: '昨天',
  date_days_ago: '${count}天前',
  date_full: '${year}年${month}月${day}日',

  // ============================================================================
  // Recent page — source labels
  // ============================================================================
  source_screenshot: '截屏录屏',
  source_camera: '相机',
  source_download: '下载',
  source_wechat: '微信',
  source_internal_storage: '内部存储',

  // ============================================================================
  // Template helpers — date formatting
  // ============================================================================
  date_days_ago_suffix: '天前',
  date_year_suffix: '年',
  date_month_suffix: '月',
  date_day_suffix: '日',

  // ============================================================================
  // Template helpers — selection toolbar
  // ============================================================================
  selected_prefix: '已选择',

  // ============================================================================
  // Template helpers — delete dialog
  // ============================================================================
  delete_confirm_prefix: '确定要删除选中的 ',
  delete_confirm_suffix: ' 个项目吗？',

  // ============================================================================
  // Template helpers — toast: deleted items
  // ============================================================================
  toast_deleted_prefix: '已删除 ',
  toast_deleted_suffix: ' 个项目',

  // ============================================================================
  // Category page — file count suffix
  // ============================================================================
  fm_file_count_suffix: ' 个文件',
} as const;

export type StringKey = keyof typeof strings;
