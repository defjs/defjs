import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ApiEntryPage } from "../components/api-entry-page";
import { apiReference, apiTargets } from "../data/api-reference";
import summaries from "../data/api-summaries.json";
import { apiVirtualFiles } from "./api-virtual";
import { buildApiEntryView, type ApiEntryView } from "./api-entry-view";
import { renderApiEntryMarkdownBySlug } from "./api-entry-markdown";
import { readableMarkdown } from "./markdown";
import {
  copyLabels,
  renderApiEntry,
  renderFieldTable,
  renderMarkdown,
  tagCopyButton,
} from "./api-html";
import { getUi } from "./ui-copy";

const ui = getUi("en-US");

function assertClean(label: string, text: string): void {
  if (text.includes("{@link") || text.includes("\\<"))
    throw new Error(`${label} leaks doc syntax`);
}

function entry(overrides: Partial<ApiEntryView> = {}): ApiEntryView {
  return {
    package: "@defjs/core",
    name: "createClient",
    kind: "function",
    source: "packages/core/src/client/client.ts",
    group: "client",
    summary: "Creates a client.",
    description: "Second paragraph.",
    signatures: ["function createClient(): Client;"],
    parameterTables: [
      {
        signature: "function createClient(value: string): Client;",
        rows: [
          {
            name: "value",
            type: 'A & B<"x">',
            required: true,
            description: "",
            deprecated: false,
          },
        ],
      },
      {
        rows: [
          {
            name: "flag",
            type: "boolean",
            required: false,
            description: "Gone",
            deprecated: true,
          },
        ],
      },
    ],
    members: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "Identifier.",
        deprecated: false,
      },
    ],
    returns: ["A client."],
    throws: ["A fault."],
    examples: [
      { type: "code", text: "const n = 1;", lang: "ts" },
      { type: "code", text: "const view = <b />;", lang: "tsx" },
      {
        type: "markdown",
        text: "See [Client](/api/core/client-type).\n\n- one\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst live = true;\n```",
        lang: "",
      },
    ],
    related: [{ name: "Client", href: "/api/core/client-type" }],
    overviewHref: "/api/client",
    ...overrides,
  };
}

test("server rendering highlights like the MDX code blocks and keeps prose", async () => {
  const rendered = await renderApiEntry(entry(), ui, "Client");
  expect(rendered.summary).toBe("Creates a client.");
  expect(rendered.name).toBe("createClient");
  expect(rendered.signaturesHtml[0]).toContain("data-api-copy");
  expect(rendered.signaturesHtml[0]).toContain(">Copy Text<");
  expect(rendered.signaturesHtml[0]).toContain("shiki-themes");
  expect(rendered.signaturesHtml[0]).toContain("github-light");
  expect(rendered.signaturesHtml[0]).toContain("github-dark");
  expect(rendered.signaturesHtml[0]).toContain("--shiki-light");
  expect(rendered.parameterSections[0]?.signatureHtml).toContain("shiki");
  expect(rendered.parameterSections[1]?.signatureHtml).toBe("");
  expect(rendered.parameterSections[1]?.tableHtml).toContain("flag?");
  expect(rendered.parameterSections[1]?.tableHtml).toContain("deprecated");
  expect(rendered.membersHtml).toContain("Identifier");
  expect(rendered.membersHtml).not.toContain('lang="en"');
  expect(rendered.descriptionHtml).toContain("Second paragraph");
  expect(rendered.examplesHtml[2]).toContain('href="/api/core/client-type"');
  expect(rendered.examplesHtml[2]).toContain("<li>one</li>");
  expect(rendered.examplesHtml[2]).toContain("shiki-themes");
  expect(rendered.overviewTitle).toBe("Client");
  const empty = await renderApiEntry(
    entry({
      description: "   ",
      signatures: [],
      parameterTables: [],
      members: [],
      returns: [],
      throws: [],
      examples: [],
    }),
    ui,
    "Client",
  );
  expect(empty.descriptionHtml).toBe("");
  expect(empty.signaturesHtml).toEqual([]);
  expect(empty.membersHtml).toBe("");
  expect(await renderMarkdown("  ", copyLabels(ui))).toBe("");
  expect(await renderFieldTable([], ui)).toBe("");
  const arabic = await renderFieldTable(
    [
      {
        name: "flag",
        type: "boolean",
        required: false,
        description: "Gone",
        deprecated: false,
      },
    ],
    getUi("ar"),
    "ar",
  );
  expect(arabic).toContain('lang="en" dir="ltr"');
  expect(arabic).toContain(">Gone</");
  expect(arabic).not.toContain(">Prop<");
  const translated = await renderApiEntry(entry(), getUi("ar"), "Client", "ar");
  expect(translated.membersHtml).toContain('lang="en" dir="ltr"');
  expect(translated.membersHtml).toContain("Identifier");
  expect(translated.descriptionHtml).not.toContain('lang="en"');
  expect(translated.signaturesHtml[0]).toContain("نسخ الشفرة");
  expect(translated.signaturesHtml[0]).toContain(
    'data-copied-label="تم نسخ الشفرة"',
  );
  const tagged = tagCopyButton(
    '<button type="button"><span class="sr-only">Copy Text</span></button><button type="button"><span class="sr-only">Copy Text</span></button>',
    { copy: 'Say "hi" & <ok>', copied: 'Done "y"' },
  );
  expect(tagged.match(/data-api-copy/g)).toHaveLength(2);
  expect(tagged).toContain('data-copied-label="Done &quot;y&quot;"');
  expect(tagged).toContain(">Say &quot;hi&quot; &amp; &lt;ok&gt;<");
  expect(tagged).not.toContain(">Copy Text<");
}, 30_000);

test("every entry page and its processed text hide raw doc links", async () => {
  expect(apiReference).toHaveLength(170);
  for (const item of apiReference) {
    const view = buildApiEntryView(item, "en-US", apiTargets());
    const rendered = await renderApiEntry(view, ui, "Overview title");
    const page = renderToStaticMarkup(
      <MemoryRouter>
        <ApiEntryPage view={rendered} locale="en-US" />
      </MemoryRouter>,
    );
    assertClean(item.slug, page);
    if (rendered.signaturesHtml.length > 0)
      expect(rendered.signaturesHtml[0]).toContain("github-light");
    const processed = renderApiEntryMarkdownBySlug(item.slug, "en-US");
    assertClean(item.slug, processed);
    assertClean(item.slug, readableMarkdown(processed, "en-US"));
  }
  const files = apiVirtualFiles(
    summaries,
    ["en-US"],
    new Set(),
    (slug, locale) =>
      Promise.resolve(renderApiEntryMarkdownBySlug(slug, locale)),
  );
  expect(files).toHaveLength(170);
  for (const file of files) {
    expect(file.type).toBe("page");
    if (file.type !== "page") continue;
    const text = await file.data.getText("processed");
    expect(text).not.toContain("{@link");
    expect(text).not.toContain("\\<");
  }
}, 180_000);
