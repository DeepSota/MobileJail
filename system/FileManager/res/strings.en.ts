import type { StringKey } from './strings';

export const stringsEn: Partial<Record<StringKey, string>> = {
  app_name: 'Files',

  // ============================================================================
  // Tab bar
  // ============================================================================
  tab_recent: 'Recent',
  tab_browse: 'Browse',
  tab_cloud: 'Cloud',

  // ============================================================================
  // Browse home page — categories
  // ============================================================================
  section_file_type: 'File types',
  section_more: 'More',
  category_documents: 'Documents',
  category_images: 'Images',
  category_videos: 'Videos',
  category_audio: 'Music',
  category_audio_alt: 'Audio',
  category_files: 'Files',

  // ============================================================================
  // Browse home page — storage
  // ============================================================================
  section_internal_storage: 'Internal storage',
  internal_storage_device: 'Internal storage',
  item_count_suffix: ' items',

  // ============================================================================
  // Folder aliases
  // ============================================================================
  alias_android: 'Android',
  alias_backups: 'ES File Explorer Backup',
  alias_baidu_netdisk: 'Baidu Netdisk',
  alias_dcim: 'Camera Roll',

  // ============================================================================
  // Selection mode
  // ============================================================================
  selected_count: '${count} selected',
  select_items_prompt: 'Select items',
  select_single_item_required: 'Please select only one item',

  // ============================================================================
  // Toolbar icon labels
  // ============================================================================
  toolbar_search: 'Search',
  toolbar_filter: 'Filter',
  toolbar_more: 'More',
  toolbar_new_folder: 'New folder',

  // ============================================================================
  // Bottom action bar
  // ============================================================================
  action_send: 'Send',
  action_move: 'Move',
  action_delete: 'Delete',
  action_more: 'More',

  // ============================================================================
  // Action menu options
  // ============================================================================
  menu_copy: 'Copy',
  menu_set_private: 'Set as private',
  menu_favorite: 'Favorite',
  menu_rename: 'Rename',
  menu_compress: 'Compress',
  menu_add_to_widget: 'Add to widget',
  menu_open_with_other_app: 'Open with other app',
  menu_details: 'Details',

  // ============================================================================
  // Dialog — common buttons
  // ============================================================================
  dialog_confirm: 'OK',
  dialog_cancel: 'Cancel',
  dialog_got_it: 'Got it',

  // ============================================================================
  // Dialog — delete confirmation
  // ============================================================================
  delete_title: 'Delete',
  delete_confirm_selected: 'Are you sure you want to delete ${count} selected items?',
  delete_confirm_folder: 'Deleting a folder will also delete all files inside it. Are you sure?',
  delete_confirm_file: 'Are you sure you want to delete this file?',

  // ============================================================================
  // Dialog — rename
  // ============================================================================
  rename_title: 'Rename',

  // ============================================================================
  // Dialog — new folder
  // ============================================================================
  new_folder_title: 'New folder',
  new_folder_placeholder: 'Folder name',
  new_folder_confirm: 'Create',

  // ============================================================================
  // Transfer sheet
  // ============================================================================
  transfer_copy_title: 'Copy to...',
  transfer_move_title: 'Move to...',
  transfer_new_folder: 'New folder',
  transfer_copy_success: 'Copied successfully',
  transfer_copy_failed: 'Copy failed',
  transfer_move_success: 'Moved successfully',
  transfer_move_failed: 'Move failed',

  // ============================================================================
  // File details dialog
  // ============================================================================
  detail_location: 'Location: ',
  detail_size: 'Size: ',
  detail_time: 'Date: ',
  detail_readable: 'Readable: ',
  detail_writable: 'Writable: ',
  detail_hidden: 'Hidden: ',
  detail_yes: 'Yes',
  detail_no: 'No',

  // ============================================================================
  // Toast messages
  // ============================================================================
  toast_deleted_items: '${count} items deleted',
  toast_rename_success: 'Renamed successfully',
  toast_rename_failed: 'Rename failed',
  toast_paste_success: 'Pasted successfully',
  toast_paste_failed: 'Paste failed',
  toast_folder_exists: 'Folder already exists',
  toast_folder_created: 'Folder created',
  toast_set_private: 'Set as private',
  toast_added_to_favorites: 'Added to favorites',
  toast_send_no_image: 'No files are available to send',
  toast_compressing: 'Compressing...',
  toast_added: 'Added',
  toast_searching_apps: 'Searching for apps...',

  // ============================================================================
  // Clipboard
  // ============================================================================
  clipboard_copied: 'Copied',
  clipboard_cut: 'Cut',
  clipboard_item_count: '${count} items',
  clipboard_paste: 'Paste',

  // ============================================================================
  // Folder page — empty state
  // ============================================================================
  folder_empty: 'Folder is empty',

  // ============================================================================
  // Text preview page
  // ============================================================================
  text_preview_no_file: 'No file selected',
  text_preview_loading: 'Opening...',
  text_preview_failed: 'Unable to open this text file',
  text_preview_empty: '(Empty file)',

  // ============================================================================
  // PDF preview page
  // ============================================================================
  pdf_preview_no_file: 'No file selected',
  pdf_preview_loading: 'Opening...',
  pdf_preview_failed: 'Unable to open this PDF file',

  // ============================================================================
  // Unified document viewer
  // ============================================================================
  viewer_no_file: 'No file selected',
  viewer_back: 'Back',
  viewer_share: 'Share',
  viewer_pages: 'Pages',
  viewer_done: 'Done',
  viewer_opening: 'Opening file…',
  viewer_rendering: 'Rendering pages…',
  viewer_rendering_spreadsheet: 'Reading workbook…',
  viewer_converting_office: 'Converting Office document…',
  viewer_converting_office_hint: 'The first preview may take a few seconds',
  viewer_search_placeholder: 'Find in document',
  viewer_search_no_results: 'No matches found',
  viewer_search_pages_suffix: ' matching pages',
  viewer_search_matches_suffix: ' matches',
  viewer_search_cells_suffix: ' matching cells',
  viewer_encoding_label: 'Encoding: ',
  viewer_wrap_on: 'Wrap',
  viewer_wrap_off: 'No wrap',
  viewer_name_box_label: 'Name box',
  viewer_formula_bar_label: 'Formula bar',
  viewer_zoom_out: 'Zoom out',
  viewer_zoom_in: 'Zoom in',
  viewer_previous_page: 'Previous page',
  viewer_next_page: 'Next page',
  viewer_pdf_page_prefix: 'PDF page ',
  viewer_pdf_page_suffix: '',
  viewer_empty_sheet: 'This sheet is empty',
  viewer_retry: 'Retry',
  viewer_cannot_open: 'Unable to open this file',
  viewer_no_compatible_app: 'No compatible app is available for this file type',
  viewer_read_failed: 'Unable to read file',
  viewer_file_missing_hint: 'The file may have been moved, renamed, or deleted',
  viewer_error_pdf: 'This PDF cannot be displayed',
  viewer_error_spreadsheet: 'This workbook cannot be displayed',
  viewer_office_failed: 'Office preview failed',
  viewer_error_generic: 'There was a problem previewing this document',
  viewer_error_empty_title: 'Empty file',
  viewer_error_empty: 'There is no content to display in this file',
  viewer_error_too_large_title: 'File too large',
  viewer_error_too_large: 'The file exceeds the on-device preview limit for this format',
  viewer_error_password_title: 'Password-protected file',
  viewer_error_password: 'Remove the document password before previewing it',
  viewer_error_damaged: 'The file may be damaged or its format may not match the extension',
  viewer_error_busy: 'The preview service is busy. Try again shortly',
  viewer_error_timeout: 'Document conversion timed out. Please retry',
  viewer_error_service_unavailable: 'The document preview service is temporarily unavailable',
  unsupported_file_close: 'Close',
  unsupported_file_message: 'No app is available to open this file',

  // ============================================================================
  // Category page — empty state
  // ============================================================================
  category_empty_prefix: 'No ',
  category_file_count: '${count} files',

  // ============================================================================
  // Cloud page
  // ============================================================================
  cloud_not_connected: 'Cloud drive not connected',

  // ============================================================================
  // Recent page — date groups
  // ============================================================================
  date_today: 'Today',
  date_yesterday: 'Yesterday',
  date_days_ago: '${count} days ago',
  date_full: '${month}/${day}/${year}',

  // ============================================================================
  // Recent page — source labels
  // ============================================================================
  source_screenshot: 'Screenshots',
  source_camera: 'Camera',
  source_download: 'Downloads',
  source_wechat: 'WeChat',
  source_internal_storage: 'Internal storage',

  // ============================================================================
  // Template helpers — date formatting
  // ============================================================================
  date_days_ago_suffix: ' days ago',
  date_year_suffix: '/',
  date_month_suffix: '/',
  date_day_suffix: '',

  // ============================================================================
  // Template helpers — selection toolbar
  // ============================================================================
  selected_prefix: '',

  // ============================================================================
  // Template helpers — delete dialog
  // ============================================================================
  delete_confirm_prefix: 'Delete ',
  delete_confirm_suffix: ' items?',

  // ============================================================================
  // Template helpers — toast: deleted items
  // ============================================================================
  toast_deleted_prefix: 'Deleted ',
  toast_deleted_suffix: ' items',

  // ============================================================================
  // Category page — file count suffix
  // ============================================================================
  fm_file_count_suffix: ' files',
};
