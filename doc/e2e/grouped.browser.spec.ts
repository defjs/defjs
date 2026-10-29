import { expect, test } from "vitest";
import { captureBrowserErrors, waitForHydration } from "./helpers";
import { openSite } from "./support/site";

test("exposes grouped navigation and modal mobile keyboard behavior", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage({
    viewport: { width: 835, height: 1204 },
  });
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/zh-Hans/docs/http"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  const navigation = page.getByRole("navigation", {
    name: "章节导航",
    exact: true,
  });
  expect(
    await navigation
      .getByRole("heading", { name: "SDK 开发", exact: true })
      .count(),
  ).toBe(1);
  expect(await navigation.getByRole("heading", { level: 2 }).count()).toBe(5);
  expect(
    await navigation.locator('[aria-current="page"]').getAttribute("href"),
  ).toBe("/zh-Hans/docs/http");
  const areas = page.getByRole("navigation", {
    name: "阅读分区",
    exact: true,
  });
  expect(
    await areas
      .getByRole("link", { name: "指南", exact: true })
      .getAttribute("href"),
  ).toBe("/zh-Hans/docs");
  expect(
    await areas
      .getByRole("link", { name: "指南", exact: true })
      .getAttribute("aria-current"),
  ).toBe("location");
  expect(
    await areas
      .getByRole("link", { name: "操作示例", exact: true })
      .getAttribute("href"),
  ).toBe("/zh-Hans/recipes");
  expect(
    await areas
      .getByRole("link", { name: "API 参考", exact: true })
      .getAttribute("href"),
  ).toBe("/zh-Hans/api");
  await areas.getByRole("link", { name: "API 参考", exact: true }).click();
  await page.waitForURL("**/zh-Hans/api");
  await navigation
    .locator('[aria-current="page"][href="/zh-Hans/api"]')
    .waitFor();
  await page.goBack({ waitUntil: "networkidle" });
  await navigation
    .locator('[aria-current="page"][href="/zh-Hans/docs/http"]')
    .waitFor();
  expect(
    await navigation.locator('[aria-current="page"]').getAttribute("href"),
  ).toBe("/zh-Hans/docs/http");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await waitForHydration(page);
  const trigger = page.getByRole("button", {
    name: "打开侧栏",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const drawer = page.locator("#nd-sidebar-mobile");
  await page.waitForFunction(() =>
    document
      .querySelector("#nd-sidebar-mobile")
      ?.contains(document.activeElement),
  );
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document
          .querySelector("#nd-sidebar-mobile")
          ?.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() =>
        document
          .querySelector("#nd-sidebar-mobile")
          ?.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  expect(
    await trigger.evaluate((node) => node === document.activeElement),
  ).toBe(true);
  await trigger.click();
  await drawer.getByRole("button", { name: "指南", exact: true }).click();
  const exampleOption = page
    .getByRole("link", { name: "操作示例", exact: true })
    .filter({ visible: true });
  await exampleOption.click();
  await exampleOption.waitFor({ state: "hidden" });
  await page.waitForURL("**/zh-Hans/recipes");
  await drawer.getByRole("heading", { name: "认证", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  await trigger.click();
  await drawer.getByRole("link", { name: "发送 JSON", exact: true }).click();
  await page.waitForURL("**/zh-Hans/recipes/post-json");
  await drawer.waitFor({ state: "hidden" });
  expect(
    await trigger.evaluate((node) => node === document.activeElement),
  ).toBe(true);

  {
    await using noJS = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const reading = await noJS.newPage();
    await reading.goto(site.url("/zh-Hans/docs/http"));
    await reading
      .getByText("章节导航", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const directory = reading
      .getByRole("navigation", { name: "章节导航", exact: true })
      .filter({ visible: true });
    expect(
      await directory
        .getByRole("link", { name: "快速开始", exact: true })
        .isVisible(),
    ).toBe(true);
    await directory
      .getByRole("link", { name: "快速开始", exact: true })
      .click();
    await reading.waitForURL("**/zh-Hans/docs/start");
    expect(await reading.locator("main h1").isVisible()).toBe(true);
  }
  expect(await errors.values()).toEqual([]);
});

test("mobile drawer initially focuses its controls and closes with Escape", async () => {
  const site = await openSite();
  const page = await site.browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await page.goto(site.url("/zh-Hans/docs/http"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  await page.locator("#nd-sidebar-mobile").waitFor();
  expect(
    await page.evaluate(() =>
      document
        .querySelector("#nd-sidebar-mobile")
        ?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.locator("#nd-sidebar-mobile").waitFor({ state: "hidden" });
  expect(await page.locator("#nd-sidebar-mobile").isVisible()).toBe(false);
});
