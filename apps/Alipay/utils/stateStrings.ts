import { getLocale, type Locale } from '@/os/locale';
import { resolveAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';

export function resolveAlipayStateStrings(
  language: string | null | undefined,
  osLocale: Locale = getLocale(),
) {
  const locale: Locale = language == null ? osLocale : (language === 'en' ? 'en' : 'zh-Hans');
  return resolveAppStrings(strings, stringsEn, locale);
}

