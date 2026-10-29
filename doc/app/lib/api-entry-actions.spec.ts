import { expect, test } from "vitest";
import {
  clientNavigationPath,
  englishAttributes,
  wrapEnglishHtml,
  type EntryClick,
} from "./api-entry-actions";

const origin = "http://localhost:3000";

function click(overrides: Partial<EntryClick> = {}): EntryClick {
  return {
    href: "/api/core/fetchhandle-type",
    target: null,
    download: false,
    discover: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    origin,
    defaultPrevented: false,
    ...overrides,
  };
}

test("english prose is marked only outside en-US", () => {
  expect(englishAttributes("en-US")).toBeNull();
  expect(englishAttributes("ar")).toEqual({ lang: "en", dir: "ltr" });
  expect(wrapEnglishHtml("", "ar")).toBe("");
  expect(wrapEnglishHtml("<p>Creates.</p>", "en-US")).toBe("<p>Creates.</p>");
  expect(wrapEnglishHtml("<p>Creates.</p>", "ar")).toBe(
    '<div lang="en" dir="ltr"><p>Creates.</p></div>',
  );
});

test("injected links navigate only for an unmodified primary click on a same-origin url", () => {
  expect(clientNavigationPath(click())).toBe("/api/core/fetchhandle-type");
  expect(
    clientNavigationPath(click({ href: "/api/core/fetchhandle-type?x=1#y" })),
  ).toBe("/api/core/fetchhandle-type?x=1#y");
  expect(clientNavigationPath(click({ href: `${origin}/api/client` }))).toBe(
    "/api/client",
  );
  expect(clientNavigationPath(click({ defaultPrevented: true }))).toBeNull();
  expect(clientNavigationPath(click({ button: 1 }))).toBeNull();
  expect(clientNavigationPath(click({ metaKey: true }))).toBeNull();
  expect(clientNavigationPath(click({ ctrlKey: true }))).toBeNull();
  expect(clientNavigationPath(click({ shiftKey: true }))).toBeNull();
  expect(clientNavigationPath(click({ altKey: true }))).toBeNull();
  expect(clientNavigationPath(click({ discover: true }))).toBeNull();
  expect(clientNavigationPath(click({ download: true }))).toBeNull();
  expect(clientNavigationPath(click({ target: "_blank" }))).toBeNull();
  expect(clientNavigationPath(click({ target: "_self" }))).toBe(
    "/api/core/fetchhandle-type",
  );
  expect(clientNavigationPath(click({ href: null }))).toBeNull();
  expect(clientNavigationPath(click({ href: "#section" }))).toBeNull();
  expect(clientNavigationPath(click({ href: "http://[" }))).toBeNull();
  expect(
    clientNavigationPath(click({ href: "javascript:alert(1)" })),
  ).toBeNull();
  expect(
    clientNavigationPath(click({ href: "https://github.com/defjs/defjs" })),
  ).toBeNull();
});
