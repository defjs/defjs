import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import {
  clientNavigationPath,
  englishAttributes,
} from "../lib/api-entry-actions";
import type { RenderedApiEntry } from "../lib/api-html";
import { getUi } from "../lib/ui-copy";

export function ApiEntryPage({
  view,
  locale,
}: {
  view: RenderedApiEntry;
  locale: string;
}) {
  const ui = getUi(locale);
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
        const pre = button.closest("figure")?.querySelector("pre");
        if (!pre) return;
        const clone = pre.cloneNode(true) as HTMLElement;
        for (const ignored of clone.querySelectorAll(".nd-copy-ignore"))
          ignored.replaceWith("\n");
        const text = clone.textContent ?? "";
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
        return;
      }
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const path = clientNavigationPath({
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
        {ui.kinds[view.kind]}
      </p>
      {view.signaturesHtml.length > 0 && (
        <section>
          <h2>{ui.signature}</h2>
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
          <h2>{ui.parameters}</h2>
          {table.signatureHtml && <Injected html={table.signatureHtml} />}
          <Injected html={table.tableHtml} />
        </section>
      ))}
      {view.membersHtml && (
        <section>
          <h2>{ui.members}</h2>
          <Injected html={view.membersHtml} />
        </section>
      )}
      <ProseList
        heading={ui.returns}
        locale={locale}
        parts={view.returnsHtml}
      />
      <ProseList heading={ui.throws} locale={locale} parts={view.throwsHtml} />
      {view.examplesHtml.length > 0 && (
        <section>
          <h2>{ui.examples}</h2>
          {view.examplesHtml.map((html, index) => (
            <EnglishHtml key={index} locale={locale} html={html} />
          ))}
        </section>
      )}
      {view.related.length > 0 && (
        <nav aria-label={ui.seeAlso}>
          <h2>{ui.seeAlso}</h2>
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

function EnglishHtml({ locale, html }: { locale: string; html: string }) {
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
  locale: string;
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
