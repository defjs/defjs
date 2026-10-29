import { expect, test } from "vitest";
import { readPageTitle, readProcessedText } from "./page-data";

test("page readers accept fumadocs page data and reject a page that cannot be indexed", async () => {
  const data = {
    title: "createClient",
    description: " Creates. ",
    getText: async (type: string) => `${type} text`,
  };
  expect(readPageTitle(data)).toBe("createClient");
  expect(await readProcessedText(data)).toBe("processed text");
  expect(() => readPageTitle({})).toThrow("title");
  expect(() => readPageTitle({ title: "" })).toThrow("title");
  expect(() => readPageTitle({ title: 1 })).toThrow("title");
  await expect(readProcessedText({})).rejects.toThrow("processed text");
  await expect(readProcessedText({ getText: async () => 1 })).rejects.toThrow(
    "not a string",
  );
  await expect(readProcessedText({ getText: "nope" })).rejects.toThrow(
    "processed text",
  );
});
