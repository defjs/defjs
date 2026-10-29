import { expect, test } from "vitest";
import {
  captureBrowserErrors,
  disableViewTransitions,
  waitForHydration,
} from "./helpers";
import { openSite } from "./support/site";

test("theme switch selects light, dark and device appearance", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage({
    colorScheme: "light",
    viewport: { width: 835, height: 1204 },
  });
  const errors = await captureBrowserErrors(page);
  await disableViewTransitions(page);
  const open = async () => {
    await page.goto(site.url("/zh-Hans/docs/integrations/react"), {
      waitUntil: "networkidle",
    });
    await waitForHydration(page);
  };
  await open();
  const theme = page.locator("#nd-sidebar [data-theme-toggle]");
  expect(
    await theme
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
  ).toEqual(["浅色", "深色", "跟随系统"]);
  await page.locator("html.light").waitFor();
  await theme.getByRole("button", { name: "深色", exact: true }).click();
  await page.locator("html.dark").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await waitForHydration(page);
  await page.locator("html.dark").waitFor();
  await theme.getByRole("button", { name: "跟随系统", exact: true }).click();
  await page.locator("html.light").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("html.dark").waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  const drawer = page.locator("#nd-sidebar-mobile");
  await drawer.getByRole("button", { name: "浅色", exact: true }).click();
  await page.locator("html.light").waitFor();
  expect(await drawer.isVisible()).toBe(true);
  expect(await errors.values()).toEqual([]);
});
