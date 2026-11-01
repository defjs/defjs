import { expect, test } from "vitest";
import { localePrefix } from "./i18n";
import { getTranslator } from "./translations";

test("the default locale is served from the root and is also the implicit locale", () => {
  expect(localePrefix()).toBe("");
  expect(localePrefix("en-US")).toBe("");
  expect(localePrefix("zh-Hans")).toBe("/zh-Hans");
});

test("an unknown locale reads English navigation and interface translations", () => {
  const english = getTranslator("en-US");
  for (const key of ["nav.navigation", "ui.error"] as const) {
    expect(getTranslator("xx-XX")(key)).toBe(english(key));
    expect(getTranslator()(key)).toBe(english(key));
    expect(getTranslator("zh-Hans")(key)).not.toBe(english(key));
  }
});
