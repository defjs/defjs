import { llmsMarkdownSlugs } from "../lib/llms";
import { docsLlms, source } from "../lib/source";
import type { Route } from "./+types/mdx";
export async function loader({ params }: Route.LoaderArgs) {
  const slugs = llmsMarkdownSlugs(params["*"]);
  if (!slugs) return new Response("Not Found", { status: 404 });
  const page = source.getPage(slugs, "en-US");
  if (!page) return new Response("Not Found", { status: 404 });
  return new Response(await docsLlms.page(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
