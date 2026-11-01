import { docsLlms } from "../lib/source";
export async function loader() {
  return new Response(await docsLlms.index("en-US"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
