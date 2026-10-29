import { expect, test } from "vitest";
import { localePrefix } from "./i18n";
import { getNav } from "./navigation-copy";
import { getUi } from "./ui-copy";

test("the default locale is served from the root and is also the implicit locale", () => {
  expect(localePrefix()).toBe("");
  expect(localePrefix("en-US")).toBe("");
  expect(localePrefix("zh-Hans")).toBe("/zh-Hans");
});

test("an unknown locale reads the English navigation and interface copy", () => {
  expect(getNav("xx-XX")).toBe(getNav("en-US"));
  expect(getNav()).toBe(getNav("en-US"));
  expect(getUi("xx-XX")).toBe(getUi("en-US"));
  expect(getUi()).toBe(getUi("en-US"));
  expect(getNav("zh-Hans")).not.toBe(getNav("en-US"));
  expect(getUi("zh-Hans")).not.toBe(getUi("en-US"));
});
