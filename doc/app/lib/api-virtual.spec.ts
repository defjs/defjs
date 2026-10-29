import { expect, test } from "vitest";
import { apiSlugOf, apiVirtualFiles, apiVirtualPath } from "./api-virtual";

const summaries = [
  { slug: "core/createclient", name: "createClient", description: "Creates." },
];

test("a content file at a generated entry path fails the build", async () => {
  const occupied = apiVirtualPath("en-US", "core/createclient");
  expect(() =>
    apiVirtualFiles(summaries, ["en-US"], new Set([occupied]), async () => ""),
  ).toThrow(`Content file shadows a generated API entry: ${occupied}`);
  const files = apiVirtualFiles(
    summaries,
    ["en-US", "ar"],
    new Set(),
    async (slug, locale) => `${locale}:${slug}`,
  );
  expect(files.map((file) => file.path)).toEqual([
    "en-US/api/core/createclient.mdx",
    "ar/api/core/createclient.mdx",
  ]);
  const page = files[0];
  if (!page || page.type !== "page") throw new Error("missing virtual page");
  expect(page.data).toMatchObject({
    title: "createClient",
    description: "Creates.",
    apiSlug: "core/createclient",
  });
  const data = page.data as { getText: (type: string) => Promise<string> };
  expect(await data.getText("processed")).toBe("en-US:core/createclient");
  expect(await data.getText("raw")).toBe("en-US:core/createclient");
  await expect(data.getText("html")).rejects.toThrow("Unsupported API text");
});

test("only a non-empty api slug marks a virtual entry", () => {
  expect(apiSlugOf(undefined)).toBeUndefined();
  expect(apiSlugOf(null)).toBeUndefined();
  expect(apiSlugOf(1)).toBeUndefined();
  expect(apiSlugOf({})).toBeUndefined();
  expect(apiSlugOf({ apiSlug: 1 })).toBeUndefined();
  expect(apiSlugOf({ apiSlug: "" })).toBeUndefined();
  expect(apiSlugOf({ apiSlug: "core/createclient" })).toBe("core/createclient");
});
