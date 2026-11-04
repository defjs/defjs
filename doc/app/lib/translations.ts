import { fromTranslations } from "@fuma-translate/react";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import { i18n } from "./i18n";
import { messages, type MessageKey, type Messages } from "./messages";

const registry = i18n
  .translations()
  .extend(uiTranslations())
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve the exact key array without an additional filtering pass or property checks
  .extend({ keys: Object.keys(messages["en-US"]) as MessageKey[] })
  .add(messages);

export type Translator = (
  key: MessageKey,
  options?: { variables?: Record<string, string> },
) => string;

export function getMessages(locale = "en-US"): Messages {
  return { ...messages["en-US"], ...registry.get(locale) };
}

export function getTranslator(locale?: string): Translator {
  return fromTranslations(getMessages(locale));
}

export function getI18nProps(locale = "en-US") {
  const language = Object.hasOwn(messages, locale) ? locale : "en-US";
  return {
    ...i18nProvider(registry, language),
    translations: getMessages(language),
  };
}
