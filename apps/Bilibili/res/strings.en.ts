import type { StringKey } from './strings';

export const stringsEn: Partial<Record<StringKey, string>> = {
  // Home tabs
  tab_live: 'Live',
  tab_recommended: 'For You',
  tab_hot: 'Trending',
  tab_anime: 'Anime',
  tab_film_tv: 'Films & TV',
  tab_new_year: 'New Year',

  // Shop items
  shop_figure: 'Figures & Statues',
  shop_blind_box: 'Blind Box',
  shop_event_show: 'Events & Shows',
  shop_all_categories: 'Categories',
  file_share_title: 'Send to a friend',
  file_share_subtitle: 'Choose a conversation or followed user',
  file_share_confirm: 'Send',
  file_share_sending: 'Sending…',
  file_share_selected: 'Selected',
  file_share_empty: 'No eligible recipients available',
  file_share_missing: 'The file is no longer available',
  file_share_error: 'Could not send. Try again.',
  file_share_recipient_unavailable: 'This user is no longer available. The file was not sent.',
  file_attachment_unavailable: 'This file no longer exists or cannot be opened.',
  file_attachment_open: 'Open attachment',
  chat_image_placeholder: '[Image]',
};
