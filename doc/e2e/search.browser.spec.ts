import type { Page } from "playwright";
import { expect, test } from "vitest";
import { locales } from "../app/lib/i18n";
import {
  captureRequests,
  holdRequests,
  selectSearchResult,
  waitForHydration,
} from "./helpers";
import type { Remote } from "./support/remote";
import { openSite } from "./support/site";

// Prose queries absent from each overview's title and description.
const overviewQueries: Record<string, { docs: string; recipes: string }> = {
  "en-US": { docs: "interception", recipes: "individual" },
  "zh-Hans": { docs: "围绕", recipes: "掌握" },
  "zh-Hant-TW": { docs: "讀到", recipes: "掌握" },
  "zh-Hant-HK": { docs: "讀到", recipes: "掌握" },
  "ja-JP": { docs: "担当", recipes: "設計" },
  "ko-KR": { docs: "맡습니다", recipes: "수명을" },
  "de-DE": { docs: "begleitet", recipes: "Lebenszyklen" },
  "fr-FR": { docs: "accompagne", recipes: "cycles" },
  "es-ES": { docs: "recorrido", recipes: "ciclos" },
  "ru-RU": { docs: "опубликованного", recipes: "жизненным" },
  ar: { docs: "يسهّل", recipes: "لتصميم" },
};

/** Text hits are `${pageUrl}-${n}`. Fumadocs navigates to `pageUrl`, not the suffixed id. */
async function selectBodyHit(
  page: Remote<Page>,
  pagePath: string,
): Promise<void> {
  const dialog = page.getByRole("dialog");
  const options = dialog.getByRole("option");
  await options.first().waitFor();
  const ids = await options.evaluateAll((nodes) =>
    nodes.map((node) => node.id),
  );
  const prefix = `fd-search-option-${pagePath}-`;
  const target = ids.find(
    (id) => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)),
  );
  if (!target) {
    throw new Error(
      `Search has no body hit for ${pagePath}: ${ids.join(", ")}`,
    );
  }
  const destination = new URL(pagePath, await page.url()).href;
  await page.locator(`[id=${JSON.stringify(target)}]`).click();
  await page.waitForURL(destination);
  await dialog.waitFor({ state: "hidden" });
}

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
  for (const locale of locales) {
    const queries = overviewQueries[locale];
    if (!queries) throw new Error(`No search fixture for ${locale}`);
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const page = await site.browser.newPage();
    const indexes = await captureRequests(page, "/api/search/");
    await page.goto(site.url(`${prefix}/docs/start`), {
      waitUntil: "networkidle",
    });
    await waitForHydration(page);
    const dialog = page.getByRole("dialog");
    for (const [area, query] of [
      ["docs", queries.docs],
      ["recipes", queries.recipes],
    ] as const) {
      await page.keyboard.press("Control+k");
      const input = dialog.getByRole("combobox");
      await input.fill("");
      await dialog.getByRole("option").first().waitFor({ state: "hidden" });
      await input.fill(query);
      await dialog
        .getByRole("option")
        .filter({ hasText: query })
        .first()
        .waitFor();
      await selectBodyHit(page, `${prefix}/${area}`);
      expect(new URL(await page.url()).pathname).toBe(`${prefix}/${area}`);
    }
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
