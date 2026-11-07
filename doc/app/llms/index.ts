import { docsLlms } from "../lib/source";
export async function loader() {
  // fumadocs types `index` as a plain string for a loader that is not async, so this keeps either result working.
  const body = await Promise.resolve(docsLlms.index("en-US"));
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
