// Canonical zh-Hans strings. StringKey is derived from this object; res/strings.en.ts is a Partial overlay.
export const strings = {
  app_name: '邮件',
  // Folder labels (used by FOLDER_CATALOG + FoldersPage)
  folder_inbox: '收件箱',
  folder_starred: '星标',
  folder_drafts: '草稿',
  folder_sent: '已发送',
  folder_trash: '回收站',

  // Top-of-page titles
  title_mailbox: '邮箱',
  title_folders: '文件夹',

  // FolderListPage
  list_default_title: '收件箱', // overridden by current folder
  list_empty_inbox: '收件箱空空如也',
  list_empty_starred: '没有星标邮件',
  list_empty_drafts: '没有草稿',
  list_empty_sent: '没有已发送邮件',
  list_empty_trash: '回收站为空',
  list_unread_suffix: '未读',
  list_draft_label: '草稿',
  list_attachment_indicator: '附件',
  action_mark_all_read: '全部已读',
  action_compose: '发邮件',
  action_switch_folder: '切换文件夹',

  // MessageDetailPage
  detail_label_from: '发件人',
  detail_label_to: '收件人',
  detail_label_cc: '抄送',
  detail_label_subject: '主题',
  detail_label_attachments: '附件',
  detail_no_subject: '（无主题）',
  detail_draft_badge: '草稿',
  detail_not_found: '邮件不存在',
  action_reply: '回复',
  action_forward: '转发',
  action_delete: '删除',
  action_star: '标星',
  action_unstar: '取消标星',
  action_edit: '编辑',
  action_restore: '恢复',
  action_move_to_trash_confirm: '确定将这封邮件移到回收站？',
  action_delete_forever_confirm: '确定永久删除这封邮件？',
  confirm_ok: '确定',
  confirm_cancel: '取消',

  // ComposePage
  compose_title_new: '新邮件',
  compose_title_edit: '编辑草稿',
  compose_label_to: '收件人',
  compose_label_cc: '抄送',
  compose_label_subject: '主题',
  compose_label_body: '正文',
  compose_placeholder_recipient: '输入邮箱或姓名',
  compose_placeholder_subject: '主题',
  compose_placeholder_body: '在这里输入正文',
  compose_show_cc: '添加抄送',
  compose_hide_cc: '收起抄送',
  compose_add_attachment: '附件',
  compose_remove_attachment_confirm_title: '删除附件',
  compose_remove_attachment_confirm_body: '确定从草稿中删除该附件吗？',
  compose_remove_attachment_confirm_ok: '删除',
  compose_remove_attachment_confirm_cancel: '取消',
  compose_button_save_draft: '存草稿',
  compose_button_send: '发送',
  compose_button_discard: '放弃',
  compose_invalid_recipient_title: '收件人无效',
  compose_invalid_recipient_body: '请输入有效的邮箱地址，或从联系人中选择。',
  compose_invalid_recipient_ok: '知道了',
  compose_empty_send_title: '无法发送',
  compose_empty_send_body: '请填写收件人，并填主题或正文。',
  compose_empty_send_ok: '知道了',
  compose_draft_saved_toast: '草稿已保存',
  compose_sent_toast: '邮件已发送',
  compose_attachment_copy_failed: '附件复制失败，请确认源文件仍然可用后重试。',
  attachment_unavailable: '附件已不存在或暂时无法打开',
  compose_remove_attachment: '移除附件',
  unsaved_changes_title: '放弃更改？',
  unsaved_changes_body: '当前编辑尚未保存，确定要放弃吗？',
  unsaved_changes_discard: '放弃',
  unsaved_changes_keep: '继续编辑',

  // AttachmentPanel
  attach_panel_title: '添加附件',
  attach_type_image: '图片',
  attach_type_document: '文档',
  attach_type_video: '视频',
  attach_type_audio: '音频',
  attach_type_camera: '拍照',
  attach_type_other: '文件',

  // RecipientPicker / display helpers
  recipient_me: '我',
  recipient_unknown: '未知',

  select_file_title: '选择文件',
  empty_file_list: '暂无文件',

  // Misc
  back: '返回',
  toast_moved_to_trash: '已移至回收站',
  toast_deleted_forever: '已永久删除',
  toast_restored: '已恢复',
  toast_starred: '已加星标',
  toast_unstarred: '已取消星标',
  toast_marked_read: '已标为已读',
} as const;

export type StringKey = keyof typeof strings;
export default strings;
