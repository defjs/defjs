import { expect, test } from "vitest";
import { apiVirtualFiles, apiVirtualPath } from "./api-virtual";

const summaries = [
  { slug: "core/createclient", name: "createClient", description: "Creates." },
];

test("a content file at a generated entry path fails the build", async () => {
  const occupied = apiVirtualPath("en-US", "core/createclient");
  expect(() =>
    apiVirtualFiles(summaries, ["en-US"], new Set([occupied]), () =>
      Promise.resolve(""),
    ),
  ).toThrow(`Content file shadows a generated API entry: ${occupied}`);
  const files = apiVirtualFiles(
    summaries,
    ["en-US", "ar"],
    new Set(),
    (slug, locale) => Promise.resolve(`${locale}:${slug}`),
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
  expect(await page.data.getText("processed")).toBe("en-US:core/createclient");
  expect(await page.data.getText("raw")).toBe("en-US:core/createclient");
});
