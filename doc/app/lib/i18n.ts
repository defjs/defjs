import { defineI18n } from 'fumadocs-core/i18n'

export const locales = ['en-US', 'zh-Hans', 'zh-Hant-TW', 'zh-Hant-HK', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'ru-RU', 'ar']
export const i18n = defineI18n({
  languages: locales,
  defaultLanguage: 'en-US',
  parser: 'dir',
  hideLocale: 'default-locale',
  fallbackLanguage: null,
})
/** URL prefix of a locale's pages; the default locale is served from the root. */
export const localePrefix = (locale = 'en-US') => (locale === 'en-US' ? '' : `/${locale}`)
