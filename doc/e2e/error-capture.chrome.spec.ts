import { expect, test } from "vitest";
import { captureBrowserErrors } from "./helpers";
import { openSite } from "./support/site";

test("preserves console error details across navigation", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  const errors = await captureBrowserErrors(page);
  await page.goto("about:blank");
  await page.evaluate(function reportSearchFailure() {
    console.error("Search render failed", new Error("Original search failure"));
  });
  await page.reload();
  const [error, ...rest] = await errors.values();
  expect(rest).toEqual([]);
  expect(error).toContain("Search render failed");
  expect(error).toContain("Original search failure");
  expect(error).toContain("reportSearchFailure");
  expect(error).not.toContain("JSHandle@object");
  expect(error).not.toContain("Execution context was destroyed");
});
