import { expect, test } from "vitest";
import catalog from "../app/data/api-entries.json";
import { defined } from "./api-model";
import { apiSlug, regularSlug, slugExceptions } from "./api-slug";

test("the regular rule and the four historical exceptions reproduce every catalog slug", () => {
  expect(catalog).toHaveLength(170);
  for (const entry of catalog)
    expect(apiSlug(entry.package, entry.name, entry.kind)).toBe(entry.slug);
  expect(apiSlug("@defjs/vue", "HTTP_CLIENT", "constant")).toBe(
    "vue/http-client",
  );
  expect(regularSlug("vue", "HTTP_CLIENT", "constant")).toBe("vue/http-client");
  for (const [identity, slug] of Object.entries(slugExceptions)) {
    const [pkg, name] = identity.split(":");
    const entry = defined(
      catalog.find((item) => item.package === pkg && item.name === name),
      identity,
    );
    expect(slug).toBe(entry.slug);
    expect(regularSlug(entry.package, entry.name, entry.kind)).not.toBe(
      entry.slug,
    );
  }
});
