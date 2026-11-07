import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { use, useMemo, type ReactNode } from "react";
import type { TOCItemType } from "fumadocs-core/toc";
import { docs, source } from "../lib/source";
import { locales, localePrefix } from "../lib/i18n";
import { getTranslator } from "../lib/translations";
import { useAppTranslations } from "../lib/use-app-translations";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import { apiEntries } from "../data/api-catalog";
import { getNavigationTree, getNavigationTabs } from "../lib/navigation";
import { siteUrl, repository } from "../lib/site";
import {
  navigationSlots,
  navigationComponents,
  StaticNavigation,
  RelatedNavigation,
} from "../components/navigation";
import { ApiEntryPage } from "../components/api-entry-page";
import { getMDXComponents } from "../components/mdx";
import { apiSlugOf } from "../lib/api-virtual";
import { readPageTitle, readProcessedText } from "../lib/page-data";
import type { RenderedApiEntry } from "../lib/api-html";
import type { Route } from "./+types/page";

async function loadRenderedEntry(
  slug: string,
  locale: string,
): Promise<{ page: RenderedApiEntry; sourcePath: string }> {
  const [{ apiEntryView }, { renderApiEntry }] = await Promise.all([
    import("../lib/api-entry-view"),
    import("../lib/api-html"),
  ]);
  const view = apiEntryView(slug, locale);
  const overview = source.getPage(["api", view.group], locale);
  const overviewTitle = overview ? readPageTitle(overview.data) : view.group;
  return {
    page: await renderApiEntry(
      view,
      getTranslator(locale),
      overviewTitle,
      locale,
    ),
    sourcePath: view.source,
  };
}

export async function loader({ params }: Route.LoaderArgs) {
  const parts = (params["*"] ?? "").split("/").filter(Boolean);
  const locale = locales.includes(parts[0] ?? "") ? parts.shift() : "en-US";
  const page = source.getPage(parts, locale);
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- INTENT: React Router routes a thrown Response to the root ErrorBoundary's 404 page; its data() helper is not an Error either, and a thrown Error becomes a 500
  if (!page) throw new Response("Not Found", { status: 404 });
  const language = locale ?? "en-US";
  const apiSlug = apiSlugOf(page.data);
  // Reference JSON and the Markdown renderer load only for a virtual entry, from this loader.
  const rendered = apiSlug ? await loadRenderedEntry(apiSlug, language) : null;
  return {
    hasContentTitle: rendered
      ? false
      : /^# /m.test(await readProcessedText(page.data)),
    path: page.path,
    home: parts.length === 0,
    slugs: parts,
    canonical: new URL(page.url, siteUrl).href,
    locale: language,
    api: rendered?.page ?? null,
    editHref: rendered
      ? `${repository}/edit/main/${rendered.sourcePath}`
      : `${repository}/edit/main/doc/content/${page.path}`,
  };
}
/** API module and symbol pages share titles with each other and with guides, so the title names the package (symbols) or "API" (modules). */
function apiTitle(title: string, slugs: string[]) {
  if (slugs[0] !== "api" || slugs.length < 2) return title;
  const entry = apiEntries.find(
    (entry) => `api/${entry.slug}` === slugs.join("/"),
  );
  return `${title} (${entry?.package ?? "API"})`;
}
export default function Page({ loaderData }: Route.ComponentProps) {
  if (loaderData.api)
    return <ApiDocument {...loaderData} view={loaderData.api} />;
  return <MdxDocument {...loaderData} />;
}
function MdxDocument({
  path,
  home,
  slugs,
  canonical,
  hasContentTitle,
  editHref,
}: Route.ComponentProps["loaderData"]) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`Missing content: ${path}`);
  const { toc } = use(page.load());
  const Content = page.body;
  const components = useMemo(() => getMDXComponents(), []);
  return (
    <DocumentFrame
      canonical={canonical}
      editHref={editHref}
      hasContentTitle={hasContentTitle}
      heading={page.title}
      description={page.description}
      documentTitle={
        home ? page.title : `${apiTitle(page.title, slugs)} | Defjs`
      }
      toc={toc}
    >
      <Content components={components} />
    </DocumentFrame>
  );
}
function ApiDocument({
  slugs,
  canonical,
  editHref,
  view,
}: Route.ComponentProps["loaderData"] & { view: RenderedApiEntry }) {
  const { locale = "en-US" } = useI18n();
  return (
    <DocumentFrame
      canonical={canonical}
      editHref={editHref}
      hasContentTitle={false}
      heading={view.name}
      description={view.summary}
      markEnglish={locale !== "en-US"}
      documentTitle={`${apiTitle(view.name, slugs)} | Defjs`}
      toc={[]}
    >
      <ApiEntryPage view={view} />
    </DocumentFrame>
  );
}
function DocumentFrame({
  canonical,
  editHref,
  hasContentTitle,
  heading,
  description,
  markEnglish = false,
  documentTitle,
  toc,
  children,
}: {
  canonical: string;
  editHref: string;
  hasContentTitle: boolean;
  heading: string;
  description: string | undefined;
  markEnglish?: boolean;
  documentTitle: string;
  toc: TOCItemType[];
  children: ReactNode;
}) {
  const { locale = "en-US" } = useI18n();
  const t = useAppTranslations();
  // The client already bundles every page's metadata, so deriving the tree here avoids serializing it into each page's HTML and .data.
  const pageTree = useMemo(
    () => getNavigationTree(source.getPageTree(locale), locale, t),
    [locale, t],
  );
  const prefix = localePrefix(locale);
  return (
    <DocsLayout
      tree={pageTree}
      i18n
      nav={{
        title: (
          <>
            <img src="/logo.jpg" alt="" width="28" height="28" /> Defjs
          </>
        ),
        url: prefix || "/",
      }}
      githubUrl={repository}
      tabMode="top"
      themeSwitch={{ mode: "light-dark-system" }}
      tabs={getNavigationTabs(pageTree)}
      slots={navigationSlots}
      sidebar={{ components: navigationComponents }}
      containerProps={{
        style: {
          gridTemplateAreas:
            '"sidebar sidebar header toc toc" "sidebar sidebar toc-popover toc toc" "sidebar sidebar tabs toc toc" "sidebar sidebar main toc toc"',
          gridTemplateRows: "auto auto auto 1fr",
        },
      }}
    >
      <DocsPage toc={toc} className="[&_h1]:wrap-anywhere">
        <link rel="canonical" href={canonical} />
        <title>{documentTitle}</title>
        {description && <meta name="description" content={description} />}
        {!hasContentTitle && <DocsTitle>{heading}</DocsTitle>}
        <DocsDescription>
          {description && markEnglish ? (
            <span lang="en" dir="ltr">
              {description}
            </span>
          ) : (
            description
          )}
        </DocsDescription>
        <StaticNavigation tree={pageTree} />
        <DocsBody>{children}</DocsBody>
        <RelatedNavigation tree={pageTree} />
        <a href={editHref}>{t("ui.edit")}</a>
        <footer className="mt-8 text-sm text-fd-muted-foreground">
          {t("ui.message")} · {t("ui.copyright")}
        </footer>
      </DocsPage>
    </DocsLayout>
  );
}
