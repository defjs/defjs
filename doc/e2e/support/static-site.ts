import type { Server } from "bun";
import { joinPath } from "../../scripts/paths";

/** Collapses `.` and `..` so a request cannot escape the site directory. */
function normalizePathname(pathname: string): string {
  const segments: string[] = [];
  for (const segment of pathname.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

export function startStaticSite(
  directory = `${import.meta.dirname}/../../build/client`,
  port = 0,
): Server<undefined> {
  const root = directory.replace(/\/+$/, "");
  return Bun.serve({
    port,
    async fetch(request) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      const path = joinPath(root, normalizePathname(pathname));
      for (const candidate of [path, joinPath(path, "index.html")]) {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
      const notFound = Bun.file(joinPath(root, "404.html"));
      return new Response((await notFound.exists()) ? notFound : "Not Found", {
        status: 404,
      });
    },
  });
}
