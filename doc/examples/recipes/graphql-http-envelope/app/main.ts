// #region example
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { loadViewer } from "./load-viewer.ts";

// Stands in for the server: a viewer, then two envelopes that carry `errors`.
const responses = [
  { data: { viewer: { id: "v-1", login: "ada" } } },
  { errors: [{ message: "viewer unavailable" }] },
  { data: null, errors: [{ message: "viewer unavailable" }] },
];
let calls = 0;
const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(() =>
    Promise.resolve(Response.json(responses[calls++], { status: 200 })),
  ),
);

async function main() {
  const [viewerErr, viewer] = await loadViewer(client);
  if (viewerErr) {
    console.error(viewerErr);
    return;
  }
  const graphQlErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [err] = await loadViewer(client);
    if (err) graphQlErrors.push(err.message);
  }
  console.log(viewer?.login, ...graphQlErrors);
}

void main();
// #endregion
