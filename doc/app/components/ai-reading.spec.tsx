import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";
import { locales } from "../lib/i18n";

const { MarkdownServer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
});

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

test("every locale documents the Skill and llms.txt resources separately", async () => {
  let englishSkill = "";
  let englishLlms = "";
  let englishDescription = "";
  for (const locale of locales) {
    const skill = await page(locale, "ai.md");
    const llms = await page(locale, "ai-api.mdx");
    expect(skill.title).toBe("Skill");
    expect(llms.title).toBe("llms.txt");
    expect(skill.description.length).toBeGreaterThan(20);
    expect(llms.description.length).toBeGreaterThan(20);
    expect(skill.html).toContain('id="install"');
    expect(skill.html).toContain('id="prompt"');
    expect(skill.html).toContain('id="verify"');
    expect(skill.html).toContain("bunx skills add defjs/defjs --skill defjs");
    expect(skill.html).toContain(`href="${skillUrl}"`);
    expect(skill.html).not.toContain("/docs/ai-api");
    const prompt = [...skill.html.matchAll(/<pre[\s\S]*?<\/pre>/g)]
      .map((match) => match[0])
      .find((block) => block.includes("/orders/:id"));
    expect(prompt).toBeDefined();
    expect(prompt).toContain("GET /orders/:id");
    expect(prompt).toContain("@defjs/core");
    expect(prompt).toContain("id: number");
    expect(prompt).toContain("status: string");
    expect(prompt?.length).toBeLessThan(650);
    expect(skill.html).toContain("getOrder(client");
    expect(skill.html).not.toContain("client.execute");
    expect(skill.html).toContain("builder");

    expect(llms.html).toContain('id="llms-txt"');
    expect(llms.html).toContain('id="llms-full"');
    expect(llms.html).toContain('id="page-markdown"');
    expect(llms.html).toContain('id="version"');
    for (const href of [
      "/llms.txt",
      "/llms-full.txt",
      "/llms.mdx/docs/start/content.md",
    ])
      expect(llms.html).toContain(`href="${href}"`);
    expect(llms.body).not.toContain("fictional-completion");
    expect(llms.body).not.toContain("withSSEHandle");

    if (locale === "en-US") {
      expect(skill.html).toContain("error slot");
      englishSkill = skill.html;
      englishLlms = llms.html;
      englishDescription = skill.description;
    } else {
      expect(skill.html).not.toBe(englishSkill);
      expect(llms.html).not.toBe(englishLlms);
      expect(skill.description).not.toBe(englishDescription);
    }
  }
});
