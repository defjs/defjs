import { expect, test, vi } from "vitest";
import { loader as index } from "./index";
import { loader as full } from "./full";

vi.mock("../lib/source", () => ({
  docsLlms: {
    index: (locale: string) => Promise.resolve(`${locale} · index`),
    full: (locale: string) => Promise.resolve(`${locale} · full`),
  },
}));

test.each([
  ["index", index, "en-US · index"],
  ["full", full, "en-US · full"],
])(
  "the %s resource returns UTF-8 text without rewriting it",
  async (_, load, body) => {
    const response = await load();
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe(body);
  },
);
