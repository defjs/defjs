import { expect, test } from "vitest";
import {
  captureBrowserErrors,
  disableViewTransitions,
  selectSearchResult,
  waitForHydration,
} from "./helpers";
import { openSite } from "./support/site";
import { locales } from "../app/lib/i18n";
import { uiCopy } from "../app/lib/ui-copy";
import { siteUrl } from "../app/lib/site";

test("accepts the built static site, locale routing and reading interactions", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage();
  const errors = await captureBrowserErrors(page);
  await disableViewTransitions(page);
  await page.goto(site.url("/"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  expect(await page.locator("main").count()).toBe(1);
  expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
  expect(await page.title()).toBe("Defjs");
  expect(await (await page.request.get(site.url("/404.html"))).status()).toBe(
    200,
  );
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const response = await page.goto(site.url(`${prefix}/docs/start`), {
      waitUntil: "networkidle",
    });
    await waitForHydration(page);
    expect(await response?.status()).toBe(200);
    await page.reload({ waitUntil: "networkidle" });
    await waitForHydration(page);
    expect(await page.locator("html").getAttribute("lang")).toBe(locale);
    expect(await page.locator("html").getAttribute("dir")).toBe(
      locale === "ar" ? "rtl" : "ltr",
    );
    expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
    expect(await page.title()).not.toBe("");
    for (const area of ["docs", "recipes", "api"])
      expect(
        await (await page.request.get(site.url(`${prefix}/${area}`))).status(),
      ).toBe(200);
  }
  await page.goto(site.url("/docs/start"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  let selected = "en-US";
  for (const target of [
    ...locales.filter((locale) => locale !== "en-US"),
    "en-US",
  ]) {
    await page
      .getByRole("button", {
        name: uiCopy[selected as keyof typeof uiCopy].translations[
          "Choose a language(language switcher)(aria-label)"
        ],
        exact: true,
      })
      .first()
      .click();
    await page
      .getByRole("button", {
        name: uiCopy[target as keyof typeof uiCopy].label,
        exact: true,
      })
      .last()
      .click();
    const prefix = target === "en-US" ? "" : `/${target}`;
    await page.waitForURL(site.url(`${prefix}/docs/start`));
    await page.locator(`html[lang="${target}"]`).waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe(target);
    await page.keyboard.press("Escape");
    selected = target;
  }
  expect(
    await (await page.request.get(site.url("/missing-path"))).status(),
  ).toBe(404);
  for (const resource of [
    "/api/search/en-US.json",
    "/llms.txt",
    "/llms-full.txt",
    "/llms.mdx/docs/start/content.md",
    "/llms.mdx/content.md",
    "/llms.mdx/api/core/definerequest/content.md",
    "/sitemap.xml",
    "/logo.jpg",
  ]) {
    const response = await page.request.get(site.url(resource));
    expect(await response.status()).toBe(200);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    if (resource.startsWith("/llms")) {
      expect(body).not.toContain("<!-- defjs-best-practice -->");
      expect(body).not.toContain("Defjs best practice for generated examples:");
    }
  }
  const llmsIndex = await (
    await page.request.get(site.url("/llms.txt"))
  ).text();
  expect(llmsIndex).toContain("](/docs/start)");
  const pageURLs = [...llmsIndex.matchAll(/\]\(([^)]+)\)/g)].map(
    (match) => new URL(match[1] ?? "", siteUrl),
  );
  expect(pageURLs.length).toBeGreaterThan(0);
  for (const url of pageURLs) {
    expect(url.origin).toBe(new URL(siteUrl).origin);
    const response = await page.request.get(site.url(url.pathname));
    expect(await response.status()).toBe(200);
    expect((await response.text()).length).toBeGreaterThan(0);
  }
  await page.goto(site.url("/api"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  await page.getByLabel("Name", { exact: true }).fill("CREATECLIENT");
  await page.getByLabel("Package", { exact: true }).selectOption("@defjs/core");
  await page.getByLabel("Category", { exact: true }).selectOption("function");
  await page
    .getByRole("link", { name: "createClient", exact: true })
    .last()
    .click();
  await page.waitForURL("**/api/core/createclient");
  await page
    .getByRole("link", { name: "ClientOption", exact: true })
    .last()
    .click();
  await page.waitForURL("**/api/core/clientoption-type");
  await page
    .getByRole("heading", { level: 1, name: "ClientOption", exact: true })
    .first()
    .waitFor();
  expect(await page.locator("main").textContent()).toContain("ClientConfig");
  await page.goto(site.url("/api"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  await page.getByLabel("Name", { exact: true }).fill("does-not-exist");
  expect(await page.getByRole("status").textContent()).toContain("0");
  expect(
    await page.getByText(uiCopy["en-US"].noResults, { exact: true }).count(),
  ).toBe(1);
  for (const locale of ["en-US", "zh-Hans", "ja-JP", "ar"]) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    await page.goto(site.url(`${prefix}/docs/start`), {
      waitUntil: "networkidle",
    });
    await waitForHydration(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.locator("input").fill("createClient");
    await dialog.getByRole("option").first().waitFor();
    // Option ids are the result URL, with a -N suffix for heading/text matches inside that page.
    const links = await dialog
      .getByRole("option")
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          node.id.replace("fd-search-option-", "").replace(/-\d+$/, ""),
        ),
      );
    expect(links.length).toBeGreaterThan(0);
    expect(
      links.every((href) =>
        locale === "en-US"
          ? !locales
              .filter((language) => language !== "en-US")
              .some((language) => href.startsWith(`/${language}/`))
          : href === prefix || href.startsWith(prefix + "/"),
      ),
    ).toBe(true);
    expect(await dialog.textContent()).not.toContain("<ApiReference");
    await selectSearchResult(page);
  }
  await page.goto(site.url("/docs/start"), {
    waitUntil: "networkidle",
  });
  await waitForHydration(page);
  await page.getByRole("button", { name: "Dark", exact: true }).first().click();
  await page.locator("html.dark").waitFor();
  expect(await page.locator("html").getAttribute("class")).toContain("dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: /Toggle Menu|Open Sidebar/ })
    .first()
    .click();
  expect(
    await page.getByRole("link", { name: /Quick start/ }).count(),
  ).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  {
    await using noJS = await browser.newContext({
      javaScriptEnabled: false,
    });
    const reading = await noJS.newPage();
    await reading.goto(site.url("/"));
    expect(await reading.locator("main").count()).toBe(1);
    expect(await reading.getByRole("heading", { level: 1 }).count()).toBe(1);
    expect(await reading.title()).toBe("Defjs");
    for (const path of ["/docs/start", "/docs", "/api/core/withtimeout"]) {
      await reading.goto(site.url(path));
      expect(
        await reading
          .locator('meta[name="description"]:not([content])')
          .count(),
      ).toBe(0);
    }
    await reading.goto(site.url("/docs/start"));
    expect(
      await reading.locator('meta[name="description"][content]').count(),
    ).toBe(1);
    expect(await reading.title()).toBe("Quick start | Defjs");
    await reading.goto(site.url("/api/core/createclient"));
    expect(await reading.locator("main").textContent()).toContain(
      "ClientOption",
    );
    await reading.goto(site.url("/api"));
    expect(
      await reading
        .getByRole("link", { name: "createClient", exact: true })
        .count(),
    ).toBeGreaterThan(0);
  }
  expect(await errors.values()).toEqual([]);
});

test("keeps long API titles readable on narrow screens", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage();
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const path of [
      "/api/core/createwebsocketinterceptor",
      "/zh-Hans/api/core/createwebsocketinterceptor",
      "/ar/api/core/createwebsocketinterceptor",
      "/api/opentelemetry-server/opentelemetryserverwebsocketoptions-type",
      "/de-DE/recipes/publish-http-sdk",
    ]) {
      await page.goto(site.url(path), {
        waitUntil: "networkidle",
      });
      await waitForHydration(page);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const title = page.getByRole("heading", { level: 1 });
      const bounds = await title.evaluate((element) => ({
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
      }));
      expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width);
    }
  }
});
