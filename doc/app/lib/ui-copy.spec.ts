import { expect, test } from "vitest";
import { apiEntries } from "../data/api-catalog";
import { locales } from "./i18n";
import { uiCopy } from "./ui-copy";

test("every locale translates the API kinds, landmarks and Fumadocs strings used by the site", () => {
  const kinds = new Set(apiEntries.map((entry) => entry.kind));
  const englishCopy = uiCopy["en-US"];
  const english = Object.keys(englishCopy.translations).sort();
  for (const locale of locales) {
    const copy = uiCopy[locale as keyof typeof uiCopy];
    for (const kind of kinds)
      expect(copy.kinds[kind as keyof typeof copy.kinds]).toBeTruthy();
    expect(Object.keys(copy).sort()).toEqual(Object.keys(englishCopy).sort());
    for (const key of [
      "signature",
      "parameters",
      "members",
      "returns",
      "throws",
      "examples",
      "seeAlso",
      "edit",
    ] as const)
      expect(copy[key]).toBeTruthy();
    expect(Object.keys(copy.translations).sort()).toEqual(english);
  }
  expect(uiCopy.ar.signature).not.toBe(uiCopy["en-US"].signature);
  expect(uiCopy["zh-Hans"].parameters).toBe("参数");
  expect(uiCopy.ar.kinds.function).not.toBe(uiCopy["en-US"].kinds.function);
});

test("search and language strings keep the meaning of the Fumadocs keys", () => {
  for (const locale of locales) {
    const copy = uiCopy[locale as keyof typeof uiCopy];
    const { translations } = copy;
    if (locale !== "en-US") {
      expect(translations["No results found(search dialog)"]).not.toBe(
        copy.noResults,
      );
      expect(translations["Choose a language(language switcher)"]).not.toBe(
        copy.label,
      );
    }
    expect(
      translations["Choose a language(language switcher)(aria-label)"],
    ).toContain(copy.label);
  }
});
