import { useTranslations } from "@fuma-translate/react";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import { defaultLocale, locales, type Locale } from "./i18n";
import type { Translator } from "./translations";

export function useAppTranslations(): Translator {
  return useTranslations();
}

/** The provider's locale. fumadocs types it as an optional string; the root layout provides the one the URL names. */
export function useLocale(): Locale {
  const { locale } = useI18n();
  return locales.find((item) => item === locale) ?? defaultLocale;
}
