import { expect, test } from "vitest";
import { captureBrowserErrors, waitForHydration } from "./helpers";
import { openSite } from "./support/site";

test("makes the current reading area and starting point visible", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage({
    viewport: { width: 835, height: 1204 },
  });
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/zh-Hans"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  for (const name of ["指南", "操作示例", "API 参考"]) {
    const link = page.getByRole("link", { name, exact: true });
    expect(await link.count()).toBe(1);
    expect(await link.isVisible()).toBe(true);
  }
  const docsTab = page.getByRole("link", { name: "指南", exact: true });
  expect((await docsTab.boundingBox())?.y).toBeLessThan(100);
  const title = page.locator("main").getByRole("heading", { level: 1 }).first();
  expect((await title.boundingBox())?.y).toBeLessThan(400);
  expect(
    await title.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return hit !== null && element.contains(hit);
    }),
  ).toBe(true);
  const sidebar = page.locator("#nd-sidebar");
  expect(
    await sidebar.getByRole("button", { name: "指南", exact: true }).count(),
  ).toBe(0);
  expect(
    await sidebar
      .getByRole("link", { name: "项目概览", exact: true })
      .getAttribute("data-active"),
  ).toBe("true");
  const start = sidebar.getByRole("link", {
    name: "快速开始",
    exact: true,
  });
  expect(await start.isVisible()).toBe(true);
  const firstChapters = await sidebar
    .locator("a[data-active]")
    .evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.textContent));
  expect(firstChapters).toEqual(["项目概览", "快速开始"]);
  expect(
    await page
      .getByRole("link", { name: "指南", exact: true })
      .getAttribute("class"),
  ).toContain("border-fd-primary");
  await start.click();
  await page.waitForURL("**/zh-Hans/docs/start");
  await sidebar
    .locator('a[href="/zh-Hans/docs/start"][data-active="true"]')
    .waitFor();
  await page.getByRole("link", { name: "操作示例", exact: true }).click();
  await page.waitForURL("**/zh-Hans/recipes");
  await sidebar.getByRole("heading", { name: "认证", exact: true }).waitFor();
  expect(
    await sidebar.getByRole("link", { name: "快速开始", exact: true }).count(),
  ).toBe(0);
  expect(
    await sidebar
      .getByRole("link", { name: "取消与超时", exact: true })
      .isVisible(),
  ).toBe(true);
  await page.getByRole("link", { name: "API 参考", exact: true }).click();
  await page.waitForURL("**/zh-Hans/api");
  await sidebar.locator('a[href="/zh-Hans/api"][data-active="true"]').waitFor();
  expect(
    await sidebar
      .getByRole("link", { name: "取消与超时", exact: true })
      .count(),
  ).toBe(0);
  expect(
    await page
      .locator("#nd-docs-layout > nav")
      .getByRole("link", { name: "API 参考", exact: true })
      .getAttribute("class"),
  ).toContain("border-fd-primary");
  {
    await using noJS = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 835, height: 1204 },
    });
    const reading = await noJS.newPage();
    await reading.goto(site.url("/zh-Hans"));
    expect(
      await reading
        .locator("#nd-sidebar")
        .getByRole("link", { name: "快速开始", exact: true })
        .isVisible(),
    ).toBe(true);
    expect(
      await reading
        .locator("main")
        .getByRole("heading", { level: 1 })
        .first()
        .evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return box.top < 400 && hit !== null && element.contains(hit);
        }),
    ).toBe(true);
    await reading.getByRole("link", { name: "操作示例", exact: true }).click();
    await reading.waitForURL("**/zh-Hans/recipes");
    expect(
      await reading
        .locator("#nd-sidebar")
        .getByRole("link", { name: "取消与超时", exact: true })
        .isVisible(),
    ).toBe(true);
  }
  const missing = await page.request.get(site.url("/missing-path"));
  expect(await missing.status()).toBe(404);
  expect(await missing.text()).toContain("<title>Page Not Found</title>");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(site.url("/zh-Hans"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  const mobile = page.locator("#nd-sidebar-mobile");
  expect(
    await mobile
      .getByRole("link", { name: "快速开始", exact: true })
      .isVisible(),
  ).toBe(true);
  await mobile.getByRole("button", { name: "指南", exact: true }).click();
  await page
    .getByRole("link", { name: "操作示例", exact: true })
    .filter({ visible: true })
    .click();
  await page.waitForURL("**/zh-Hans/recipes");
  await mobile.getByRole("heading", { name: "认证", exact: true }).waitFor();
  expect(await errors.values()).toEqual([]);
});
