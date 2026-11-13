import { useTranslations } from "@fuma-translate/react";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { locales, localePrefix } from "../lib/i18n";
import { getTranslator } from "../lib/translations";
import { useLocale } from "../lib/use-app-translations";
import { TestI18nProvider as Translated } from "./test-i18n";
import { apiEntries } from "../data/api-catalog";
import { ApiIndex } from "./api-index";
import NotFound from "../routes/not-found";

function TranslationProbe() {
  const t = useTranslations();
  const { locale } = useI18n();
  return (
    <p lang={locale}>
      {t("nav.readingAreas")} ·{" "}
      {t("ui.results", { variables: { count: "12" } })}
    </p>
  );
}

test("the real Fumadocs Provider shares its translations with React and server consumers", () => {
  for (const locale of locales) {
    const t = getTranslator(locale);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Translated locale={locale}>
          <TranslationProbe />
        </Translated>
      </MemoryRouter>,
    );
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(t("nav.readingAreas"));
    expect(html).toContain(t("ui.results", { variables: { count: "12" } }));
  }
});

test("localized API forms and 404 pages render with no client-side translation step", () => {
  for (const locale of ["en-US", "zh-Hans", "ar"] as const) {
    const t = getTranslator(locale);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Translated locale={locale}>
          <ApiIndex />
          <NotFound />
        </Translated>
      </MemoryRouter>,
    );
    expect(html).toContain(t("ui.name"));
    expect(html).toContain(t("ui.allPackages"));
    expect(html).toContain(t("ui.allCategories"));
    expect(html).toContain(
      t("ui.results", { variables: { count: String(apiEntries.length) } }),
    );
    expect(html).toContain(t("Page Not Found(404 page)"));
    expect(html).toContain(t("Back to Home(404 page)"));
    expect(html).toContain(`href="${localePrefix(locale) || "/"}"`);
    expect(html).not.toContain("{count}");
  }
});

test("a component outside the Provider reads the default locale", () => {
  function LocaleProbe() {
    return <p lang={useLocale()} />;
  }
  expect(renderToStaticMarkup(<LocaleProbe />)).toBe('<p lang="en-US"></p>');
});

test("custom React UI reads overrides from the same Provider as built-in UI", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Translated
        locale="zh-Hans"
        translations={{
          "ui.name": "Provider field label",
          "Page Not Found(404 page)": "Provider missing page",
          "Back to Home(404 page)": "Provider home link",
        }}
      >
        <ApiIndex />
        <NotFound />
      </Translated>
    </MemoryRouter>,
  );
  expect(html).toContain("Provider field label");
  expect(html).toContain("Provider missing page");
  expect(html).toContain("Provider home link");
  expect(html).toContain('href="/zh-Hans/api/core/createclient"');
});
