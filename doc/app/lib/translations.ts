import { fromTranslations } from "@fuma-translate/react";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import { defaultLocale, i18n, type Locale } from "./i18n";
import { messages, type MessageKey, type Messages } from "./messages";

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(messages[defaultLocale], key);
}

const registry = i18n
  .translations()
  .extend(uiTranslations())
  .extend({ keys: Object.keys(messages[defaultLocale]).filter(isMessageKey) })
  .add(messages);

export type Translator = (
  key: MessageKey,
  options?: { variables?: Record<string, string> },
) => string;

/** A copy, so a caller cannot change the shared resource. */
export function getMessages(locale: Locale): Messages {
  return { ...messages[locale] };
}

export function getTranslator(locale: Locale): Translator {
  return fromTranslations(getMessages(locale));
}

export function getI18nProps(locale: Locale) {
  return {
    ...i18nProvider(registry, locale),
    translations: getMessages(locale),
  };
}
