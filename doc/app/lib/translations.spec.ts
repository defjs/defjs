import { expect, test } from "vitest";
import { locales, i18n } from "./i18n";
import { apiEntries } from "../data/api-catalog";
import { messages } from "./messages";
import { getMessages, getTranslator, getI18nProps } from "./translations";

test("UI translations use semantic keys and library interpolation", () => {
  const chinese = getTranslator("zh-Hans");
  const english = getTranslator("en-US");
  expect(chinese("nav.guide.ai")).toBe("AI");
  expect(chinese("nav.guide.sdkDevelopment")).toBe("SDK 开发");
  expect(chinese("ui.results", { variables: { count: "12" } })).toBe(
    "结果：12",
  );
  expect(english("ui.results", { variables: { count: "0" } })).toBe(
    "Results: 0",
  );
  expect(chinese("api.parameters")).toBe("参数");
});

test("all eleven message resources are complete without relying on UI fallback", () => {
  expect(Object.keys(messages).sort()).toEqual([...locales].sort());
  const keys = Object.keys(messages["en-US"]).sort();
  for (const kind of new Set(apiEntries.map((entry) => entry.kind)))
    expect(keys).toContain(`api.kind.${kind}`);
  for (const resource of Object.values(messages)) {
    expect(Object.keys(resource).sort()).toEqual(keys);
    for (const value of Object.values(resource))
      expect(value.length).toBeGreaterThan(0);
  }
});

test("search and language labels retain their distinct meanings", () => {
  for (const locale of locales) {
    const t = getTranslator(locale);
    expect(t("Choose a language(language switcher)(aria-label)")).toContain(
      t("ui.language"),
    );
    if (locale !== "en-US") {
      expect(t("No results found(search dialog)")).not.toBe(t("ui.noResults"));
      expect(t("Choose a language(language switcher)")).not.toBe(
        t("ui.language"),
      );
    }
    for (const kind of ["function", "type", "constant"] as const)
      expect(t(`api.kind.${kind}`)).not.toBe("");
  }
  expect(getTranslator("ar")("api.signature")).not.toBe(
    getTranslator()("api.signature"),
  );
  expect(getTranslator("ar")("api.kind.function")).not.toBe(
    getTranslator()("api.kind.function"),
  );
});

test("UI fallback does not change the no-fallback content configuration", () => {
  expect(getMessages()).toEqual(getMessages("en-US"));
  expect(getMessages("unknown")).toEqual(getMessages("en-US"));
  expect(getTranslator("unknown")("nav.related")).toBe("Related reading");
  expect(getTranslator()("ui.language")).toBe("English");
  expect(i18n.fallbackLanguage).toBeNull();
});

test("per-call translations and returned messages cannot change another locale", () => {
  const english = getTranslator("en-US");
  const arabic = getTranslator("ar");
  const snapshot = getMessages("zh-Hans");
  snapshot["api.parameters"] = "changed";
  expect(getTranslator("zh-Hans")("api.parameters")).toBe("参数");
  expect(arabic("api.parameters")).toBe("المعاملات");
  expect(english("api.parameters")).toBe("Parameters");
});

test("Fumadocs Provider and standalone translators use the same locale messages", () => {
  for (const locale of locales) {
    const props = getI18nProps(locale);
    expect(props.locale).toBe(locale);
    expect(props.defaultLanguage).toBe("en-US");
    expect(props.hideLocale).toBe("default-locale");
    expect(props.translations).toEqual(getMessages(locale));
    expect(props.locales?.map((item) => item.locale)).toEqual(locales);
    for (const item of props.locales ?? [])
      expect(item.name).toBe(getTranslator(item.locale)("ui.language"));
  }
  expect(getI18nProps().locale).toBe("en-US");
  expect(getI18nProps("unknown").locale).toBe("en-US");
});
