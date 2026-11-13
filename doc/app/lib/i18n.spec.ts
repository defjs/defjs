import { expect, test } from "vitest";
import { localePrefix, splitLocale } from "./i18n";

test("the default locale is served from the root", () => {
  expect(localePrefix("en-US")).toBe("");
  expect(localePrefix("zh-Hans")).toBe("/zh-Hans");
});

test("a path names its locale in the first segment or belongs to the default locale", () => {
  expect(splitLocale(["zh-Hans", "docs", "http"])).toEqual({
    locale: "zh-Hans",
    rest: ["docs", "http"],
  });
  expect(splitLocale(["docs", "http"])).toEqual({
    locale: "en-US",
    rest: ["docs", "http"],
  });
  expect(splitLocale([])).toEqual({ locale: "en-US", rest: [] });
});
