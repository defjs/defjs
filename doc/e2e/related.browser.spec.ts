import { expect, test } from "vitest";
import reference from "../app/data/api-reference.json";
import { locales } from "../app/lib/i18n";
import { uiCopy } from "../app/lib/ui-copy";
import { captureBrowserErrors } from "./helpers";
import { openSite } from "./support/site";

function catalogSignature(names: readonly string[]): string {
  return names
    .map((name) => {
      const signatures = reference.find(
        (entry) => entry.name === name,
      )?.signatures;
      if (!signatures?.length) throw new Error(`missing signature ${name}`);
      return signatures.map((signature) => signature.trim()).join("\n");
    })
    .join("\n\n");
}

test("connects HTTP guides, examples and module API without truncating related links", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage();
  const errors = await captureBrowserErrors(page);
  for (const [path, targets] of [
    [
      "/zh-Hans/docs/http",
      [
        "/zh-Hans/recipes/post-json",
        "/zh-Hans/recipes/publish-http-sdk",
        "/zh-Hans/api/http",
      ],
    ],
    [
      "/zh-Hans/recipes/post-json",
      [
        "/zh-Hans/docs/http",
        "/zh-Hans/docs/commands",
        "/zh-Hans/api/http",
        "/zh-Hans/api/struct",
      ],
    ],
    [
      "/zh-Hans/api/http",
      [
        "/zh-Hans/docs/http",
        "/zh-Hans/recipes/post-json",
        "/zh-Hans/recipes/publish-http-sdk",
      ],
    ],
  ] as const) {
    await page.goto(site.url(path), {
      waitUntil: "networkidle",
    });
    const related = page.getByRole("navigation", {
      name: "相关阅读",
      exact: true,
    });
    expect(await related.count()).toBe(1);
    for (const href of targets)
      expect(await related.locator(`a[href="${href}"]`).count()).toBe(1);
    expect(await related.locator(`a[href="${path}"]`).count()).toBe(0);
  }
  {
    await using noJS = await browser.newContext({
      javaScriptEnabled: false,
    });
    const reading = await noJS.newPage();
    await reading.goto(site.url("/zh-Hans/recipes/post-json"));
    const related = reading.getByRole("navigation", {
      name: "相关阅读",
      exact: true,
    });
    await related.locator('a[href="/zh-Hans/api/http"]').click();
    await reading.waitForURL("**/zh-Hans/api/http");
    expect(
      await related.locator('a[href="/zh-Hans/docs/http"]').isVisible(),
    ).toBe(true);
  }
  expect(await errors.values()).toEqual([]);
});

test("an API entry shows its highlighted signature and copies it", async () => {
  const site = await openSite();
  await using context = await site.browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const main = page.locator("main");
  const text = await main.textContent();
  expect(text).toContain(
    "function createClient(...options: ClientOption[]): Client;",
  );
  expect(text).toContain("...options");
  expect(text).toContain("Creates a Defjs client");
  const copy = page.locator("main button[data-api-copy]").first();
  expect(await copy.isVisible()).toBe(true);
  expect(await copy.locator(".sr-only").textContent()).toBe("Copy Text");
  await copy.click();
  const clipboard = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  });
  expect(clipboard.replace(/\n$/u, "")).toBe(
    "function createClient(...options: ClientOption[]): Client;",
  );
  expect(await errors.values()).toEqual([]);
});

test("API links inside an entry navigate without a full page load", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/api/core/withhttphandle"), {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => {
    (window as unknown as { __apiMarker?: string }).__apiMarker = "client-nav";
  });
  await page
    .locator("main")
    .locator('a[href="/api/core/fetchhandle-type"]')
    .first()
    .click();
  await page.waitForURL("**/api/core/fetchhandle-type");
  expect(
    await page.evaluate(
      () => (window as unknown as { __apiMarker?: string }).__apiMarker,
    ),
  ).toBe("client-nav");
  expect(await errors.values()).toEqual([]);
});

test("an entry links back to its overview through a click and to its source file", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  const errors = await captureBrowserErrors(page);
  for (const [path, overview] of [
    ["/api/core/createclient", "/api/client"],
    ["/zh-Hans/api/core/createclient", "/zh-Hans/api/client"],
  ] as const) {
    await page.goto(site.url(path), {
      waitUntil: "networkidle",
    });
    const nav = page.locator("main").locator("nav[aria-label='Client']");
    expect(await nav.locator("a").textContent()).toBe("Client");
    expect(await nav.locator("a").getAttribute("href")).toBe(overview);
    expect(
      await page
        .locator(
          "a[href='https://github.com/defjs/defjs/edit/main/packages/core/src/client/client.ts']",
        )
        .isVisible(),
    ).toBe(true);
    await nav.locator("a").click();
    await page.waitForURL(`**${overview}`);
  }
  expect(await errors.values()).toEqual([]);
});

test("translated entry pages keep English prose but localize their labels", async () => {
  const site = await openSite();
  const { browser } = site;
  const page = await browser.newPage();
  const errors = await captureBrowserErrors(page);
  await page.goto(site.url("/zh-Hans/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const chinese = page.locator("main");
  const chineseText = await chinese.textContent();
  expect(await chinese.innerHTML()).toContain(
    `>${uiCopy["zh-Hans"].parameters}<`,
  );
  expect(chineseText).toContain(
    "function createClient(...options: ClientOption[]): Client;",
  );
  expect(chineseText).toContain("Creates a Defjs client");
  await page.goto(site.url("/ar/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const article = await page.locator("article").innerHTML();
  expect(article).toContain('lang="en"');
  expect(article).toContain('dir="ltr"');
  expect(article).toContain("Creates a Defjs client");
  expect(article).not.toMatch(
    new RegExp(`<h2[^>]*lang="en"[^>]*>${uiCopy.ar.signature}`),
  );
  expect(article).toContain(`>${uiCopy.ar.signature}<`);
  const arabicMarks = await page.evaluate(() => {
    const article = document.querySelector("article");
    const marked = article ? [...article.querySelectorAll("[lang='en']")] : [];
    const headings = article
      ? [...article.querySelectorAll("h1, h2, h3")].filter(
          (heading) => heading.closest("[lang='en']") !== null,
        )
      : [];
    return {
      summary: marked.some((node) =>
        (node.textContent ?? "").includes("Creates a Defjs client"),
      ),
      parameter: marked.some((node) =>
        (node.textContent ?? "").includes("Client option helpers"),
      ),
      headings: headings.map((heading) => heading.textContent ?? ""),
    };
  });
  expect(arabicMarks.summary).toBe(true);
  expect(arabicMarks.parameter).toBe(true);
  expect(arabicMarks.headings).toEqual([]);
  const arabicCopy = page.locator("main button[data-api-copy]").first();
  expect(await arabicCopy.locator(".sr-only").textContent()).toBe(
    uiCopy.ar.translations["Copy Text(code block)(aria-label)"],
  );
  expect(await errors.values()).toEqual([]);
});

test("overview pages render catalog signatures for every language", async () => {
  const pages = [
    ["http", catalogSignature(["defineRequest"])],
    [
      "interceptors",
      catalogSignature([
        "createHttpInterceptor",
        "InterceptorFn",
        "HttpInterceptorNext",
      ]),
    ],
  ] as const;
  const site = await openSite();
  const page = await site.browser.newPage();
  const errors = await captureBrowserErrors(page);
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    for (const [slug, signature] of pages) {
      await page.goto(site.url(`${prefix}/api/${slug}`), {
        waitUntil: "networkidle",
      });
      const block = page
        .locator("main pre")
        .filter({ hasText: signature })
        .first();
      const figure = block.locator("xpath=ancestor::figure");
      expect(await page.locator("body").innerHTML()).not.toContain(
        "<ApiSignature",
      );
      expect(await figure.locator("button").count()).toBeGreaterThan(0);
      expect((await block.textContent())?.replace(/\s+$/u, "")).toBe(signature);
    }
  }
  expect(await errors.values()).toEqual([]);
});
