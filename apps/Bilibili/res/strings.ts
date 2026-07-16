/**
 * Bilibili 字符串资源 — 对应 AOSP res/values/strings.xml
 */
export const strings = {
  // Home tabs
  tab_live: '直播',
  tab_recommended: '推荐',
  tab_hot: '热门',
  tab_anime: '动画',
  tab_film_tv: '影视',
  tab_new_year: '跨年',

  // Shop items
  shop_figure: '手办雕像',
  shop_blind_box: '盲盒',
  shop_event_show: '漫展演出',
  shop_all_categories: '分类',

  // Private file sharing
  file_share_title: '发送给好友',
  file_share_subtitle: '选择私信会话或关注用户',
  file_share_confirm: '发送',
  file_share_sending: '正在发送…',
  file_share_selected: '已选择',
  file_share_empty: '暂无可发送的用户',
  file_share_missing: '文件已不可用',
  file_share_error: '发送失败，请重试',
  file_share_recipient_unavailable: '该用户已不可用，文件未发送',
  file_attachment_unavailable: '文件已不存在或无法打开',
  file_attachment_open: '打开附件',
  chat_image_placeholder: '[图片]',
} as const;

export type StringKey = keyof typeof strings;
