import { expect, test } from "vitest";
import { locales } from "../app/lib/i18n";
import { getTranslator } from "../app/lib/translations";
import { captureBrowserErrors, waitForHydration } from "./helpers";
import { openSite } from "./support/site";

const aiGroup = {
  "en-US": "AI",
  "zh-Hans": "AI",
  "zh-Hant-TW": "AI",
  "zh-Hant-HK": "AI",
  "ja-JP": "AI",
  "ko-KR": "AI",
  "de-DE": "KI",
  "fr-FR": "IA",
  "es-ES": "IA",
  "ru-RU": "ИИ",
  ar: "الذكاء الاصطناعي",
} as const;
const aiPageTitle = {
  "en-US": "AI-assisted development",
  "zh-Hans": "AI 辅助开发",
  "zh-Hant-TW": "AI 輔助開發",
  "zh-Hant-HK": "AI 輔助開發",
  "ja-JP": "AI を活用した開発",
  "ko-KR": "AI 지원 개발",
  "de-DE": "KI-gestützte Entwicklung",
  "fr-FR": "Développement assisté par IA",
  "es-ES": "Desarrollo asistido por IA",
  "ru-RU": "Разработка с помощью ИИ",
  ar: "التطوير بمساعدة الذكاء الاصطناعي",
} as const;
const aiApiTitle = {
  "en-US": "Calling AI APIs",
  "zh-Hans": "调用 AI API",
  "zh-Hant-TW": "呼叫 AI API",
  "zh-Hant-HK": "呼叫 AI API",
  "ja-JP": "AI API の呼び出し",
  "ko-KR": "AI API 호출",
  "de-DE": "KI-APIs aufrufen",
  "fr-FR": "Appeler des API d’IA",
  "es-ES": "Llamar a API de IA",
  "ru-RU": "Вызов API ИИ",
  ar: "استدعاء واجهات الذكاء الاصطناعي",
} as const;
const guideTitle = {
  "en-US": "Guide",
  "zh-Hans": "指南",
  "zh-Hant-TW": "指南",
  "zh-Hant-HK": "指南",
  "ja-JP": "ガイド",
  "ko-KR": "가이드",
  "de-DE": "Leitfaden",
  "fr-FR": "Guide",
  "es-ES": "Guía",
  "ru-RU": "Руководство",
  ar: "الدليل",
} as const;

test("makes the current reading area and starting point visible", async () => {
  const site = await openSite();
  const page = await site.browser.newPage({
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
  expect(await errors.values()).toEqual([]);
});

test("the sidebar follows the active reading area", async () => {
  const site = await openSite();
  const page = await site.browser.newPage({
    viewport: { width: 835, height: 1204 },
  });
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/zh-Hans"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  const sidebar = page.locator("#nd-sidebar");
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
  expect(await errors.values()).toEqual([]);
});

test("the home page keeps its reading areas without JavaScript", async () => {
  const site = await openSite();
  const { browser } = site;
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
});

test("the mobile drawer lists the active reading area", async () => {
  const site = await openSite();
  const page = await site.browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const errors = await captureBrowserErrors(page);
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

test("every locale shows both AI guides under Guide", async () => {
  const site = await openSite();
  const page = await site.browser.newPage({
    viewport: { width: 835, height: 1204 },
  });
  const errors = await captureBrowserErrors(page);
  let englishDescription = "";
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const t = getTranslator(locale);
    const pages = [
      ["/docs/ai", aiPageTitle[locale as keyof typeof aiPageTitle]],
      ["/docs/ai-api", aiApiTitle[locale as keyof typeof aiApiTitle]],
    ] as const;
    for (const [path, title] of pages) {
      await page.goto(site.url(`${prefix}${path}`), {
        waitUntil: "networkidle",
      });
      await waitForHydration(page);
      const areas = page.getByRole("navigation", {
        name: t("nav.readingAreas"),
        exact: true,
      });
      expect(await areas.getByRole("link").count()).toBe(3);
      const selected = areas.locator('[aria-current="location"]');
      expect(await selected.count()).toBe(1);
      expect(await selected.getAttribute("href")).toBe(`${prefix}/docs`);
      expect(await selected.textContent()).toBe(
        guideTitle[locale as keyof typeof guideTitle],
      );
      const sidebar = page.locator("#nd-sidebar");
      expect(
        await sidebar
          .getByRole("heading", {
            name: aiGroup[locale as keyof typeof aiGroup],
            exact: true,
          })
          .count(),
      ).toBe(1);
      expect(
        await sidebar
          .locator(`a[href="${prefix}${path}"][aria-current="page"]`)
          .textContent(),
      ).toBe(title);
      expect(await page.locator("main h1").first().textContent()).toBe(title);
      const prose = page.locator("#nd-page div.prose");
      if (path === "/docs/ai") {
        expect(await prose.innerText()).toContain(
          "npx skills add defjs/defjs --skill defjs",
        );
        for (const href of [
          "/llms.txt",
          "/llms-full.txt",
          "/llms.mdx/docs/start/content.md",
        ]) {
          const link = prose.locator(`a[href="${href}"]`);
          expect(await link.count()).toBeGreaterThan(0);
          await link.first().click({ trial: true });
        }
        const description = await page
          .locator('meta[name="description"]')
          .getAttribute("content");
        expect(description && description.length > 20).toBe(true);
        if (locale === "en-US") englishDescription = description ?? "";
        else expect(description).not.toBe(englishDescription);
      } else {
        const callingText = await prose.innerText();
        expect(callingText).toContain('data: {"text":"Hello"}');
        expect(callingText).toContain('data: {"text":" there"}');
        expect(callingText).toContain("Hello there");
        for (const href of [
          `${prefix}/docs/http`,
          `${prefix}/docs/sse`,
          `${prefix}/recipes/post-json`,
          `${prefix}/recipes/consume-sse`,
          `${prefix}/recipes/cancel-http`,
        ]) {
          const link = prose.locator(`a[href="${href}"]`);
          expect(await link.count()).toBeGreaterThan(0);
          await link.first().click({ trial: true });
        }
      }
    }
  }
  expect(await errors.values()).toEqual([]);
});

test("AI resource links open their text documents", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  const errors = await captureBrowserErrors(page);
  for (const [href, contentType, text] of [
    ["/llms.txt", "text/plain", "# Docs"],
    ["/llms-full.txt", "text/plain", "@defjs/core"],
    ["/llms.mdx/docs/start/content.md", "text/markdown", "# Getting started"],
  ] as const) {
    await page.goto(site.url("/zh-Hans/docs/ai"), {
      waitUntil: "networkidle",
    });
    await waitForHydration(page);
    await page.locator(`#nd-page div.prose a[href="${href}"]`).click();
    await page.waitForURL(site.url(href));
    expect(await page.evaluate(() => document.contentType)).toBe(contentType);
    expect(await page.locator("body").innerText()).toContain(text);
  }
  expect(await errors.values()).toEqual([]);
});

test("the mobile drawer opens the AI guide inside Guide", async () => {
  const site = await openSite();
  const page = await site.browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/zh-Hans"), { waitUntil: "networkidle" });
  await waitForHydration(page);
  await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
  const mobile = page.locator("#nd-sidebar-mobile");
  await mobile.getByRole("heading", { name: "AI", exact: true }).waitFor();
  await mobile.getByRole("link", { name: "AI 辅助开发", exact: true }).click();
  await page.waitForURL("**/zh-Hans/docs/ai");
  await mobile
    .locator('a[href="/zh-Hans/docs/ai"][aria-current="page"]')
    .waitFor();
  expect(
    await mobile.getByRole("button", { name: "指南", exact: true }).count(),
  ).toBe(1);
  expect(
    await page
      .locator("#nd-page div.prose")
      .locator('a[href="/llms.txt"]')
      .isVisible(),
  ).toBe(true);
  expect(await errors.values()).toEqual([]);
});

test("the AI guide stays inside Guide without JavaScript", async () => {
  const site = await openSite();
  const { browser } = site;
  await using desktop = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 835, height: 1204 },
  });
  const reading = await desktop.newPage();
  await reading.goto(site.url("/zh-Hans/docs/ai"));
  const areas = reading.getByRole("navigation", {
    name: "阅读分区",
    exact: true,
  });
  expect(await areas.getByRole("link").count()).toBe(3);
  expect(
    await areas
      .getByRole("link", { name: "指南", exact: true })
      .getAttribute("aria-current"),
  ).toBe("location");
  const sidebar = reading.locator("#nd-sidebar");
  expect(
    await sidebar.getByRole("heading", { name: "AI", exact: true }).isVisible(),
  ).toBe(true);
  expect(
    await sidebar
      .locator('a[href="/zh-Hans/docs/ai"][aria-current="page"]')
      .isVisible(),
  ).toBe(true);
  await reading.goto(site.url("/zh-Hans/docs/ai-api"));
  expect(
    await areas
      .getByRole("link", { name: "指南", exact: true })
      .getAttribute("aria-current"),
  ).toBe("location");
  expect(
    await sidebar
      .locator('a[href="/zh-Hans/docs/ai-api"][aria-current="page"]')
      .isVisible(),
  ).toBe(true);
  await using phone = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const narrow = await phone.newPage();
  await narrow.goto(site.url("/zh-Hans/docs/ai"));
  await narrow
    .getByText("章节导航", { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const fallback = narrow.locator("ul.navigation-static-list");
  expect(
    await fallback
      .getByRole("heading", { name: "AI", exact: true })
      .isVisible(),
  ).toBe(true);
  expect(
    await fallback
      .locator('a[href="/zh-Hans/docs/ai"][aria-current="page"]')
      .isVisible(),
  ).toBe(true);
  expect(
    await fallback
      .locator("xpath=ancestor::details[1]")
      .locator('a[href="/zh-Hans/docs"]')
      .isVisible(),
  ).toBe(true);
});
