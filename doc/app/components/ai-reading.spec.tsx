import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";
import { locales } from "../lib/i18n";

const { MarkdownServer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
});

function localeText(table: object, locale: string): string {
  if (!Object.hasOwn(table, locale)) throw new Error(`missing ${locale}`);
  const value: unknown = Reflect.get(table, locale);
  if (typeof value !== "string") throw new Error(`missing ${locale}`);
  return value;
}

const assisted = {
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

const api = {
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

const secretMarker = {
  "en-US": "browser bundle",
  "zh-Hans": "浏览器",
  "zh-Hant-TW": "用戶端",
  "zh-Hant-HK": "客戶端",
  "ja-JP": "ブラウザ",
  "ko-KR": "브라우저",
  "de-DE": "Browser-Bundle",
  "fr-FR": "paquet navigateur",
  "es-ES": "paquete del navegador",
  "ru-RU": "браузер",
  ar: "المتصفح",
} as const;

const skillUrl =
  "https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md";

function frontmatter(text: string): {
  title: string;
  description: string;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  const block = match?.[1];
  const body = match?.[2];
  const title = /^title:\s*(.+)$/m
    .exec(block ?? "")?.[1]
    ?.replace(/^["']|["']$/g, "");
  const description = /^description:\s*(.+)$/m
    .exec(block ?? "")?.[1]
    ?.replace(/^["']|["']$/g, "");
  if (!title || !description || body === undefined)
    throw new Error("AI page is missing title, description, or body");
  return { title, description, body };
}

async function page(locale: string, name: string) {
  const file = await Bun.file(
    new URL(`../../content/${locale}/docs/${name}`, import.meta.url),
  ).text();
  const parsed = frontmatter(file);
  const element = await MarkdownServer({ children: parsed.body });
  return { ...parsed, html: renderToStaticMarkup(element) };
}

test("every locale keeps assistant resources and the AI call-site guide on separate pages", async () => {
  let englishAssisted = "";
  let englishApi = "";
  let englishDescription = "";
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const copy = locale;
    const guide = await page(locale, "ai.md");
    const calling = await page(locale, "ai-api.mdx");
    expect(guide.title).toBe(localeText(assisted, copy));
    expect(calling.title).toBe(localeText(api, copy));
    expect(guide.description.length).toBeGreaterThan(20);
    expect(calling.description.length).toBeGreaterThan(20);
    expect(guide.html).toContain('id="install"');
    expect(guide.html).toContain('id="prompt"');
    expect(guide.html).toContain('id="verify"');
    expect(guide.html).toContain('id="resources"');
    expect(guide.html).toContain("npx skills add defjs/defjs --skill defjs");
    expect(guide.html).toContain("22.20");
    expect(guide.html).toContain(`href="${prefix}/docs/start"`);
    expect(guide.html).toContain(`href="${prefix}/docs/ai-api"`);
    for (const href of [
      "/llms.txt",
      "/llms-full.txt",
      "/llms.mdx/docs/start/content.md",
      skillUrl,
    ])
      expect(guide.html).toContain(`href="${href}"`);
    const links = [...guide.html.matchAll(/href="([^"]*)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(links.filter((href) => /mcp/i.test(href))).toEqual([]);
    const prompt = [...guide.html.matchAll(/<pre[\s\S]*?<\/pre>/g)]
      .map((match) => match[0])
      .find((block) => block.includes("/orders/:id"));
    expect(prompt).toBeDefined();
    expect(prompt).toContain("GET /orders/:id");
    expect(prompt).toContain("@defjs/core");
    expect(prompt).toContain("id: number");
    expect(prompt).toContain("status: string");
    expect(prompt?.length).toBeLessThan(650);
    expect(guide.html).toContain("getOrder(client");
    expect(guide.html).not.toContain("client.execute");
    expect(guide.html).toContain("builder");
    expect(calling.html).toContain('id="call-an-api"');
    expect(calling.html).toContain('id="fictional-stream"');
    expect(calling.html).toContain(localeText(secretMarker, copy));
    expect(calling.html).toContain("withSSEHandle");
    expect(calling.body).toContain(
      "examples/ai/fictional-completion.ts#example",
    );
    expect(calling.html).not.toMatch(/first event is a complete/i);
    for (const href of [
      `${prefix}/docs/ai`,
      `${prefix}/docs/http`,
      `${prefix}/docs/sse`,
      `${prefix}/docs/client`,
      `${prefix}/docs/interceptors`,
      `${prefix}/recipes/post-json`,
      `${prefix}/recipes/consume-sse`,
      `${prefix}/recipes/cancel-http`,
    ])
      expect(calling.html).toContain(`href="${href}"`);
    if (locale === "en-US") {
      expect(guide.html).toContain("error slot");
      expect(calling.html).toContain("not a complete AI response");
      expect(calling.html).toContain("fictional");
      englishAssisted = guide.html;
      englishApi = calling.html;
      englishDescription = guide.description;
    } else {
      expect(guide.html).not.toBe(englishAssisted);
      expect(calling.html).not.toBe(englishApi);
      expect(guide.description).not.toBe(englishDescription);
    }
  }
});
