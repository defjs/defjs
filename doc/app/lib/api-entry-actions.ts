/** English API prose on a translated page. en-US stays unmarked. */
export function englishAttributes(
  locale: string,
): { lang: "en"; dir: "ltr" } | null {
  if (locale === "en-US") return null;
  return { lang: "en", dir: "ltr" };
}

export function wrapEnglishHtml(html: string, locale: string): string {
  if (!html) return "";
  const attributes = englishAttributes(locale);
  if (!attributes) return html;
  return `<div lang="${attributes.lang}" dir="${attributes.dir}">${html}</div>`;
}

export interface EntryClick {
  href: string | null;
  target: string | null;
  download: boolean;
  discover: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  origin: string;
  defaultPrevented: boolean;
}

/** Same-origin path for a plain injected link, or null when the browser should handle the click. */
export function clientNavigationPath(click: EntryClick): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey)
    return null;
  if (click.discover || click.download) return null;
  if (click.target && click.target !== "_self") return null;
  const href = click.href;
  if (!href || href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(href, click.origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== click.origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
