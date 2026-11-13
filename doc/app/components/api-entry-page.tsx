import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import {
  clientNavigationPath,
  englishAttributes,
} from "../lib/api-entry-actions";
import type { RenderedApiEntry } from "../lib/api-html";
import type { Locale } from "../lib/i18n";
import { useAppTranslations, useLocale } from "../lib/use-app-translations";

export function ApiEntryPage({ view }: { view: RenderedApiEntry }) {
  const locale = useLocale();
  const t = useAppTranslations();
  const prose = englishAttributes(locale);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const timers = new Set<number>();
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-api-copy]");
      if (button instanceof HTMLButtonElement) {
        event.preventDefault();
        copyCodeBlock(button, timers);
        return;
      }
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const path = injectedLinkPath(anchor, event);
      if (!path) return;
      event.preventDefault();
      void navigate(path);
    };
    node.addEventListener("click", onClick);
    return () => {
      node.removeEventListener("click", onClick);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [navigate]);
  return (
    <div ref={root}>
      <p>
        <code {...(prose ?? {})}>{view.packageName}</code> ·{" "}
        {t(`api.kind.${view.kind}`)}
      </p>
      {view.signaturesHtml.length > 0 && (
        <section>
          <h2>{t("api.signature")}</h2>
          {view.signaturesHtml.map((html, index) => (
            <Injected key={index} html={html} />
          ))}
        </section>
      )}
      {view.descriptionHtml && (
        <EnglishHtml locale={locale} html={view.descriptionHtml} />
      )}
      {view.parameterSections.map((table, index) => (
        <section key={index}>
          <h2>{t("api.parameters")}</h2>
          {table.signatureHtml && <Injected html={table.signatureHtml} />}
          <Injected html={table.tableHtml} />
        </section>
      ))}
      {view.membersHtml && (
        <section>
          <h2>{t("api.members")}</h2>
          <Injected html={view.membersHtml} />
        </section>
      )}
      <ProseList
        heading={t("api.returns")}
        locale={locale}
        parts={view.returnsHtml}
      />
      <ProseList
        heading={t("api.throws")}
        locale={locale}
        parts={view.throwsHtml}
      />
      {view.examplesHtml.length > 0 && (
        <section>
          <h2>{t("api.examples")}</h2>
          {view.examplesHtml.map((html, index) => (
            <EnglishHtml key={index} locale={locale} html={html} />
          ))}
        </section>
      )}
      {view.related.length > 0 && (
        <nav aria-label={t("api.seeAlso")}>
          <h2>{t("api.seeAlso")}</h2>
          {view.related.map((target) => (
            <Link
              className="me-3"
              key={target.href}
              to={target.href}
              {...(prose ?? {})}
            >
              {target.name}
            </Link>
          ))}
        </nav>
      )}
      <nav aria-label={view.overviewTitle}>
        <Link to={view.overviewHref}>{view.overviewTitle}</Link>
      </nav>
    </div>
  );
}

/** Copies the code of the block that owns `button` and shows the copied state for 1.5 s; `timers` holds the pending resets. */
function copyCodeBlock(button: HTMLButtonElement, timers: Set<number>): void {
  const pre = button.closest("figure")?.querySelector("pre");
  if (!pre) return;
  const scratch = document.createElement("div");
  scratch.append(pre.cloneNode(true));
  for (const ignored of scratch.querySelectorAll(".nd-copy-ignore"))
    ignored.replaceWith("\n");
  const text = scratch.textContent ?? "";
  const copied = button.getAttribute("data-copied-label") ?? "";
  const label = button.querySelector(".sr-only");
  const idle = label?.textContent ?? "";
  const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  if (!write) return;
  void Promise.resolve()
    .then(() => write(text))
    .then(() => {
      button.setAttribute("data-checked", "true");
      if (label) label.textContent = copied;
      const timer = window.setTimeout(() => {
        button.removeAttribute("data-checked");
        if (label) label.textContent = idle;
        timers.delete(timer);
      }, 1500);
      timers.add(timer);
    })
    .catch(() => undefined);
}

/** The path to navigate to on the client for a click on an injected link, or null when the browser should handle it. */
function injectedLinkPath(
  anchor: HTMLAnchorElement,
  event: MouseEvent,
): string | null {
  return clientNavigationPath({
    href: anchor.getAttribute("href"),
    target: anchor.getAttribute("target"),
    download: anchor.hasAttribute("download"),
    discover: anchor.hasAttribute("data-discover"),
    button: event.button,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    origin: window.location.origin,
    defaultPrevented: event.defaultPrevented,
  });
}

function EnglishHtml({ locale, html }: { locale: Locale; html: string }) {
  const prose = englishAttributes(locale);
  if (!prose) return <Injected html={html} />;
  return (
    <div lang={prose.lang} dir={prose.dir}>
      <Injected html={html} />
    </div>
  );
}

function Injected({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function ProseList({
  heading,
  locale,
  parts,
}: {
  heading: string;
  locale: Locale;
  parts: string[];
}) {
  if (parts.length === 0) return null;
  return (
    <section>
      <h2>{heading}</h2>
      {parts.map((html, index) => (
        <EnglishHtml key={index} locale={locale} html={html} />
      ))}
    </section>
  );
}
