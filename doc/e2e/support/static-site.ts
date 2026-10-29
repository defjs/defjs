import { relative, resolve, sep, isAbsolute } from "node:path";
import type { Server } from "bun";

export function startStaticSite(
  directory = resolve(import.meta.dirname, "../../build/client"),
  port = 0,
): Server<undefined> {
  const root = resolve(directory);
  return Bun.serve({
    port,
    async fetch(request) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      const path = resolve(root, "." + pathname);
      const fromRoot = relative(root, path);
      if (
        fromRoot === ".." ||
        fromRoot.startsWith(".." + sep) ||
        isAbsolute(fromRoot)
      )
        return new Response("Forbidden", { status: 403 });
      for (const candidate of [path, resolve(path, "index.html")]) {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
      const notFound = Bun.file(resolve(root, "404.html"));
      return new Response((await notFound.exists()) ? notFound : "Not Found", {
        status: 404,
      });
    },
  });
}
