import { expect, test } from "vitest";
import reference from "../app/data/api-reference.json";
import { captureBrowserErrors } from "./helpers";
import { openSite } from "./support/site";

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

test("an API entry shows its highlighted signature, a linked symbol and its overview", async () => {
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
  const html = await main.innerHTML();
  const text = await main.textContent();
  const signatureAt = html.indexOf(">Signature<");
  expect(html.indexOf("--shiki-light", signatureAt)).toBeGreaterThan(
    signatureAt,
  );
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
  await page.goto(site.url("/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const overview = main.locator("nav[aria-label='Client']");
  expect(await overview.locator("a").textContent()).toBe("Client");
  expect(await overview.locator("a").getAttribute("href")).toBe("/api/client");
  expect(
    await page
      .locator(
        "a[href='https://github.com/defjs/defjs/edit/main/packages/core/src/client/client.ts']",
      )
      .isVisible(),
  ).toBe(true);
  await page.goto(site.url("/zh-Hans/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const chinese = page.locator("main");
  const chineseHtml = await chinese.innerHTML();
  const chineseText = await chinese.textContent();
  const chineseSignature = chineseHtml.indexOf(">签名<");
  expect(
    chineseHtml.indexOf("--shiki-light", chineseSignature),
  ).toBeGreaterThan(chineseSignature);
  expect(chineseHtml).toContain(">参数<");
  expect(chineseText).toContain(
    "function createClient(...options: ClientOption[]): Client;",
  );
  expect(chineseText).toContain("Creates a Defjs client");
  const chineseOverview = chinese.locator("nav[aria-label='Client']");
  expect(await chineseOverview.locator("a").textContent()).toBe("Client");
  expect(await chineseOverview.locator("a").getAttribute("href")).toBe(
    "/zh-Hans/api/client",
  );
  expect(
    await page
      .locator(
        "a[href='https://github.com/defjs/defjs/edit/main/packages/core/src/client/client.ts']",
      )
      .isVisible(),
  ).toBe(true);
  await chineseOverview.locator("a").click();
  await page.waitForURL("**/zh-Hans/api/client");
  await page.goto(site.url("/ar/api/core/createclient"), {
    waitUntil: "networkidle",
  });
  const arabic = await page.locator("article").innerHTML();
  expect(arabic).toContain('lang="en"');
  expect(arabic).toContain('dir="ltr"');
  expect(arabic).toContain("Creates a Defjs client");
  expect(arabic).not.toMatch(/<h2[^>]*lang="en"[^>]*>التوقيع/);
  expect(arabic).toContain(">التوقيع<");
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
  expect(await arabicCopy.locator(".sr-only").textContent()).toBe("نسخ الشفرة");
  expect(await errors.values()).toEqual([]);
});

test("an overview page renders the generated signature, highlighted, in English and Chinese", async () => {
  const signature = reference.find((entry) => entry.name === "defineRequest")
    ?.signatures[0];
  if (!signature) throw new Error("missing defineRequest signature");
  const site = await openSite();
  const page = await site.browser.newPage();
  const errors = await captureBrowserErrors(page);
  for (const path of ["/api/http", "/zh-Hans/api/http"]) {
    await page.goto(site.url(path), { waitUntil: "networkidle" });
    const block = await page.evaluate(() => {
      const pre = [...document.querySelectorAll("main pre")].find((node) =>
        (node.textContent ?? "").includes("function defineRequest"),
      );
      const figure = pre?.closest("figure");
      return {
        text: pre?.textContent ?? "",
        highlighted: figure?.innerHTML.includes("--shiki-light") ?? false,
        copy: figure?.querySelector("button") != null,
        raw: document.body.innerHTML.includes("<ApiSignature"),
      };
    });
    expect(block.raw).toBe(false);
    expect(block.highlighted).toBe(true);
    expect(block.copy).toBe(true);
    expect(block.text.replace(/\s+$/u, "")).toBe(signature.trim());
  }
  expect(await errors.values()).toEqual([]);
});
