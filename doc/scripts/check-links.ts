import { statSync } from "node:fs";
import { resolve } from "node:path";

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function checkLinks(directory: string): Promise<void> {
  const root = resolve(directory);
  const pages = new Map<string, { ids: Set<string>; links: string[] }>();
  for await (const filename of new Bun.Glob("**/*.html").scan(root)) {
    if (filename === "__spa-fallback.html") continue;
    const page = { ids: new Set<string>(), links: [] as string[] };
    await new HTMLRewriter()
      .on("[id]", {
        element(element) {
          // The selector guarantees the attribute exists, so getAttribute never returns null here.
          page.ids.add(element.getAttribute("id") as string);
        },
      })
      .on("[href]", {
        element(element) {
          page.links.push(element.getAttribute("href") as string);
        },
      })
      .on("[src]", {
        element(element) {
          page.links.push(element.getAttribute("src") as string);
        },
      })
      .transform(new Response(Bun.file(resolve(root, filename))))
      .text();
    pages.set(resolve(root, filename), page);
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
      const path = resolve(root, "." + decodeURIComponent(url.pathname));
      const target = [path, resolve(path, "index.html")].find((candidate) =>
        pages.has(candidate),
      );
      // A directory is a page only when index.html was emitted; every other non-file is missing.
      if (!target) {
        if (!isRegularFile(path))
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
if (import.meta.main)
  await checkLinks(new URL("../build/client/", import.meta.url).pathname);
