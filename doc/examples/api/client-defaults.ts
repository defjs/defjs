// #region example
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHeaders,
} from "@defjs/core";

const client = createClient(
  withEndpoint("https://api.example.com"),
  withHeaders({ "X-Client": "web", Accept: "application/json" }),
);

const search = defineRequest({
  method: "GET",
  path: "/search",
  input: struct.object({ q: struct.string() }),
  // This request's Accept replaces the client default; X-Client is still sent.
  builder: (input) => ({ query: input, headers: { Accept: "text/plain" } }),
  output: struct.string(),
});

async function main() {
  const [error, text] = await search(
    client({ signal: AbortSignal.timeout(30_000) }),
    { q: "defjs" },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(text);
}

void main();
// #endregion
