import { getLocale, type Locale } from '@/os/locale';
import { resolveAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';

export function resolveRedBookStateStrings(
  language: string | null | undefined,
  osLocale: Locale = getLocale(),
) {
  const locale: Locale = language == null ? osLocale : (language === 'en-US' ? 'en' : 'zh-Hans');
  return resolveAppStrings(strings, stringsEn, locale);
}

export function resolveUnknownRedBookUserName(
  userId: string,
  language: string | null | undefined,
  osLocale?: Locale,
): string {
  return resolveRedBookStateStrings(language, osLocale)
    .chat_unknown_user
    .replace('{userId}', userId);
}

