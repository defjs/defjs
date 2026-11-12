import { docRoot, joinPath } from "./paths";

async function isRegularFile(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export async function checkLinks(directory: string): Promise<void> {
  const root = directory.replace(/\/+$/, "");
  const pages = new Map<string, { ids: Set<string>; links: string[] }>();
  for await (const filename of new Bun.Glob("**/*.html").scan(root)) {
    if (filename === "__spa-fallback.html") continue;
    const page: { ids: Set<string>; links: string[] } = {
      ids: new Set<string>(),
      links: [],
    };
    await new HTMLRewriter()
      .on("[id]", {
        element(element) {
          // The selector guarantees the attribute exists, so getAttribute never returns null here.
          page.ids.add(String(element.getAttribute("id")));
        },
      })
      .on("[href]", {
        element(element) {
          page.links.push(String(element.getAttribute("href")));
        },
      })
      .on("[src]", {
        element(element) {
          page.links.push(String(element.getAttribute("src")));
        },
      })
      .transform(new Response(Bun.file(joinPath(root, filename))))
      .text();
    pages.set(joinPath(root, filename), page);
  }
  if (!pages.size) throw new Error("No generated documentation pages found");
  const failures = new Set<string>();
  for (const [filename, page] of pages) {
    const pathname =
      "/" + filename.slice(root.length + 1).replace(/index\.html$/, "");
    const base = new URL(pathname, "https://docs.invalid");
    for (const href of page.links) {
      const url = new URL(href, base);
      if (
        url.origin !== base.origin ||
        !["http:", "https:"].includes(url.protocol)
      )
        continue;
      const path = joinPath(root, decodeURIComponent(url.pathname));
      const target = [path, joinPath(path, "index.html")].find((candidate) =>
        pages.has(candidate),
      );
      // A directory is a page only when index.html was emitted; every other non-file is missing.
      if (!target) {
        if (!(await isRegularFile(path)))
          failures.add(`${base.pathname}: missing page ${href}`);
        continue;
      }
      if (
        url.hash &&
        !pages.get(target)?.ids.has(decodeURIComponent(url.hash.slice(1)))
      )
        failures.add(`${base.pathname}: missing anchor ${href}`);
    }
  }
  if (failures.size)
    throw new Error(
      `Broken documentation links (${failures.size}):\n${[...failures].join("\n")}`,
    );
  console.log(
    `Documentation links verified across ${pages.size} generated pages`,
  );
}
/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) await checkLinks(joinPath(docRoot, "build/client"));
