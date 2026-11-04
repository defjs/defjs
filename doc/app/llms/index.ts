import { docsLlms } from "../lib/source";
export async function loader() {
  // eslint-disable-next-line @typescript-eslint/await-thenable -- `index()` is typed Awaitable<string> and returns a promise here
  return new Response(await docsLlms.index("en-US"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
