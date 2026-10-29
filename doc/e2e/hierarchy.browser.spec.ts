import type { Remote } from "./support/remote";
import type { Locator } from "playwright";
import { expect, test } from "vitest";
import { captureBrowserErrors, waitForHydration } from "./helpers";
import { openSite } from "./support/site";

async function textBox(element: Remote<Locator>) {
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
}

test("keeps API symbols nested beneath their native package folder", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage({
    viewport: { width: 835, height: 1204 },
  });
  await page.goto(site.url("/zh-Hans/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const sidebar = page.locator("#nd-sidebar");
  const folder = await textBox(
    sidebar.getByRole("button", { name: "Core", exact: true }),
  );
  const symbol = await textBox(sidebar.locator('a[aria-current="page"]'));
  expect(symbol.left - folder.left).toBeGreaterThanOrEqual(12);
});

test("distinguishes navigation groups from their children in both reading directions", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage();
  const errors = await captureBrowserErrors(page);
  for (const [path, width, rtl] of [
    ["/zh-Hans", 835, false],
    ["/ar", 835, true],
    ["/de-DE", 768, false],
  ] as const) {
    await page.setViewportSize({ width, height: 1204 });
    await page.goto(site.url(path), {
      waitUntil: "networkidle",
    });
    const sidebar = page.locator("#nd-sidebar");
    const heading = sidebar.getByRole("heading", { level: 2 }).first();
    const overview = sidebar.locator(`a[href="${path}"][aria-current="page"]`);
    const group = await textBox(heading);
    const child = await textBox(overview);
    expect(
      rtl ? group.right - child.right : child.left - group.left,
    ).toBeGreaterThanOrEqual(12);
    const headingWeight = await heading.evaluate((node) =>
      Number(getComputedStyle(node).fontWeight),
    );
    const childWeight = await overview.evaluate((node) =>
      Number(getComputedStyle(node).fontWeight),
    );
    expect(headingWeight).toBeGreaterThan(childWeight);
    expect(
      await overview.evaluate((node) =>
        Number.parseFloat(
          getComputedStyle(node, "::before").borderInlineStartWidth,
        ),
      ),
    ).toBeGreaterThan(0);
    const decision = sidebar.locator(`a[href="${path}/docs/design-decisions"]`);
    const standalone = await textBox(decision);
    expect(
      Math.abs(
        rtl ? standalone.right - group.right : standalone.left - group.left,
      ),
    ).toBeLessThanOrEqual(2);
    expect(await sidebar.getByRole("heading", { level: 2 }).count()).toBe(5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(site.url("/zh-Hans"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  const drawer = page.locator("#nd-sidebar-mobile");
  await drawer.waitFor();
  await drawer
    .getByRole("link", { name: "快速开始", exact: true })
    .click({ trial: true });
  const group = await textBox(
    drawer.getByRole("heading", { level: 2 }).first(),
  );
  const child = await textBox(
    drawer.getByRole("link", { name: "快速开始", exact: true }),
  );
  expect(child.left - group.left).toBeGreaterThanOrEqual(12);
  await drawer.getByRole("link", { name: "快速开始", exact: true }).click();
  await page.waitForURL("**/zh-Hans/docs/start");
  await drawer.waitFor({ state: "hidden" });
  {
    await using noJS = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const reading = await noJS.newPage();
    await reading.goto(site.url("/zh-Hans/docs/start"));
    await reading
      .getByText("章节导航", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const directory = reading
      .getByRole("navigation", { name: "章节导航", exact: true })
      .filter({ visible: true });
    const heading = await textBox(
      directory.getByRole("heading", { level: 2 }).first(),
    );
    const start = await textBox(
      directory.getByRole("link", { name: "快速开始", exact: true }),
    );
    expect(start.left - heading.left).toBeGreaterThanOrEqual(12);
    await directory
      .getByRole("link", { name: "HTTP 请求", exact: true })
      .click();
    await reading.waitForURL("**/zh-Hans/docs/http");
  }
  expect(await errors.values()).toEqual([]);
});
