import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ApiEntryPage } from "./api-entry-page";
import type { RenderedApiEntry } from "../lib/api-html";
import { uiCopy } from "../lib/ui-copy";

function view(overrides: Partial<RenderedApiEntry> = {}): RenderedApiEntry {
  return {
    packageName: "@defjs/core",
    name: "createClient",
    kind: "function",
    summary: "Creates a client.",
    signaturesHtml: [
      "<pre>function createClient(...options: ClientOption[]): Client;</pre>",
    ],
    descriptionHtml: '<p>BODY <a href="/api/core/client-type">Client</a></p>',
    parameterSections: [
      {
        signatureHtml: "",
        tableHtml: "<code>...options?</code>",
      },
    ],
    membersHtml: "<code>client</code>",
    returnsHtml: ["<p>A client.</p>"],
    throwsHtml: ["<p>A fault.</p>"],
    examplesHtml: ["<pre>const client = 1;</pre>"],
    related: [{ name: "Client", href: "/api/core/client-type" }],
    overviewHref: "/api/client",
    overviewTitle: "Client",
    ...overrides,
  };
}

const render = (entry: RenderedApiEntry, locale = "en-US") =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ApiEntryPage view={entry} locale={locale} />
    </MemoryRouter>,
  );

test("an entry page shows signature, then prose, fields, examples and the overview title", () => {
  const html = render(view());
  const marks = [
    "@defjs/core",
    uiCopy["en-US"].signature,
    "BODY",
    uiCopy["en-US"].parameters,
    uiCopy["en-US"].members,
    uiCopy["en-US"].returns,
    uiCopy["en-US"].throws,
    uiCopy["en-US"].examples,
    uiCopy["en-US"].seeAlso,
    ">Client</a>",
  ];
  let cursor = -1;
  for (const mark of marks) {
    const at = html.indexOf(mark, cursor + 1);
    if (at <= cursor) throw new Error(`section out of order: ${mark}`);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
  expect(html).toContain(
    "function createClient(...options: ClientOption[]): Client;",
  );
  expect(html).toContain("...options?");
  expect(html).toContain('href="/api/core/client-type"');
  expect(html).toContain('href="/api/client"');
  expect(html).toContain("const client = 1;");
  expect(html).toContain(">A client.</");
  expect(html).not.toContain("Creates a client.");
  expect(html).not.toContain('lang="en"');
});

test("empty sections stay hidden and members use the locale", () => {
  const html = render(
    view({
      signaturesHtml: [],
      descriptionHtml: "",
      parameterSections: [
        {
          signatureHtml: "<pre>function enum(value: number): void;</pre>",
          tableHtml: "<code>value</code>",
        },
      ],
      membersHtml: "<code>client</code>",
      returnsHtml: [],
      throwsHtml: [],
      examplesHtml: ["<p>A <code>note</code>.</p>"],
      related: [],
      overviewHref: "/zh-Hans/api/client",
      overviewTitle: "客户端",
    }),
    "zh-Hans",
  );
  expect(html).not.toContain(uiCopy["zh-Hans"].signature);
  expect(html).not.toContain(uiCopy["zh-Hans"].seeAlso);
  expect(html).toContain(uiCopy["zh-Hans"].members);
  expect(html).toContain(uiCopy["zh-Hans"].kinds.function);
  expect(html).toContain('lang="en"');
  expect(html).not.toContain(`<h2 lang="en">${uiCopy["zh-Hans"].members}</h2>`);
  expect(html).toContain("function enum(value: number): void;");
  expect(html).toContain(">value</code>");
  expect(html).toContain(">client</code>");
  expect(html).toContain("<code>note</code>");
  expect(html).toContain('href="/zh-Hans/api/client"');
  expect(html).toContain("客户端");
  const linked = render(
    view({
      related: [
        {
          name: "FetchHandle",
          href: "/zh-Hans/api/core/fetchhandle-type",
        },
      ],
    }),
    "zh-Hans",
  );
  const seeAlso = linked.indexOf(uiCopy["zh-Hans"].seeAlso);
  const nameAt = linked.indexOf(">FetchHandle</a>", seeAlso);
  expect(linked.slice(linked.lastIndexOf("<a", nameAt), nameAt)).toContain(
    'lang="en"',
  );
  expect(linked.slice(linked.lastIndexOf("<a", nameAt), nameAt)).toContain(
    'dir="ltr"',
  );
  const overviewAt = linked.indexOf(">Client</a>", nameAt);
  expect(
    linked.slice(linked.lastIndexOf("<a", overviewAt), overviewAt),
  ).not.toContain('lang="en"');
});
