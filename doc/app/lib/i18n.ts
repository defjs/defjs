import { defineI18n } from "fumadocs-core/i18n";

export const locales = [
  "en-US",
  "zh-Hans",
  "zh-Hant-TW",
  "zh-Hant-HK",
  "ja-JP",
  "ko-KR",
  "de-DE",
  "fr-FR",
  "es-ES",
  "ru-RU",
  "ar",
] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale = "en-US" satisfies Locale;
export const i18n = defineI18n({
  languages: [...locales],
  defaultLanguage: defaultLocale,
  parser: "dir",
  hideLocale: "default-locale",
  fallbackLanguage: null,
});
/** The locale that path segments name first, and the segments after it. A path that names none belongs to the default locale. */
export function splitLocale(segments: readonly string[]): {
  locale: Locale;
  rest: string[];
} {
  const locale = locales.find((item) => item === segments[0]);
  return locale
    ? { locale, rest: segments.slice(1) }
    : { locale: defaultLocale, rest: [...segments] };
}
/** URL prefix of a locale's pages; the default locale is served from the root. */
export const localePrefix = (locale: Locale) =>
  locale === defaultLocale ? "" : `/${locale}`;
