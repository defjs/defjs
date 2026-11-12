import { expect, test } from "vitest";
import { apiEntries } from "./api-catalog";
import { apiReference } from "./api-reference";
import summaries from "./api-summaries.json";
import { firstParagraph } from "../lib/api-text";

test("page summaries are the first paragraph of every reference entry, in catalog order", () => {
  expect(summaries).toEqual(
    apiReference.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      description: firstParagraph(entry.description),
    })),
  );
  expect(summaries.map((entry) => entry.slug)).toEqual(
    apiEntries.map((entry) => entry.slug),
  );
});
