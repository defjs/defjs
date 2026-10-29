import { expect, test } from "vitest";
import {
  captureRequests,
  holdRequests,
  selectSearchResult,
  waitForHydration,
} from "./helpers";
import { openSite } from "./support/site";

test("waits for hydration before sending the search shortcut", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  const hold = await holdRequests(page, /\/assets\/entry\.client-.*\.js$/);
  const entryRequested = page.waitForRequest(/\/assets\/entry\.client-.*\.js$/);
  await page.goto(site.url("/docs/start"), { waitUntil: "commit" });
  await entryRequested;
  await page.getByRole("heading", { level: 1 }).waitFor();
  expect(await page.locator("body").getAttribute("data-hydrated")).not.toBe(
    "true",
  );
  await hold.release();
  await waitForHydration(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").waitFor();
  expect(await page.getByRole("combobox").isVisible()).toBe(true);
});

test("downloads only the search index of the reading language", async () => {
  const site = await openSite();
  for (const locale of ["en-US", "ja-JP"]) {
    const page = await site.browser.newPage();
    const indexes = await captureRequests(page, "/api/search/");
    await page.goto(
      site.url(`${locale === "en-US" ? "" : `/${locale}`}/docs/start`),
      { waitUntil: "networkidle" },
    );
    await waitForHydration(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").fill("createClient");
    await dialog.getByRole("option").first().waitFor();
    expect(await indexes.values()).toEqual([`/api/search/${locale}.json`]);
    await page.close();
  }
});

test("waits for the selected search destination while its loader is pending", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  await page.goto(site.url("/docs/start"), { waitUntil: "networkidle" });
  await waitForHydration(page);
  await page.locator("[data-search-full]").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("createClient");
  const selected = dialog.getByRole("option", { selected: true });
  const id = await selected.getAttribute("id");
  if (!id?.startsWith("fd-search-option-"))
    throw new Error("Search result has no destination");
  const destination = new URL(
    id.slice("fd-search-option-".length),
    site.url("/"),
  );
  const loader = new RegExp(
    `${destination.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.data$`,
  );
  const hold = await holdRequests(page, loader);
  const requested = page.waitForRequest(loader);
  let finished = false;
  const selection = selectSearchResult(page).then(() => {
    finished = true;
  });
  await requested;
  await dialog.waitFor({ state: "hidden" });
  expect(await page.evaluate(() => location.pathname)).toBe("/docs/start");
  expect(finished).toBe(false);
  await hold.release();
  await selection;
  expect(await page.url()).toBe(destination.href);
});
