// #region example
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  type Client,
} from "@defjs/core";

const VIEWER_QUERY = "query Viewer { viewer { id login } }" as const;

const runViewer = defineRequest({
  method: "POST",
  path: "/graphql",
  builder: () => ({
    body: { query: VIEWER_QUERY, operationName: "Viewer" },
  }),
  output: struct.object({
    data: struct
      .object({
        viewer: struct
          .object({ id: struct.string(), login: struct.string() })
          .null(),
      })
      .nullish(),
    errors: struct
      .array(struct.object({ message: struct.string() }))
      .optional(),
  }),
});

async function loadViewer(client: Client) {
  const [error, result] = await client.execute(runViewer());
  if (error) throw error;
  if (result.errors?.length) {
    throw new Error(result.errors.map((item) => item.message).join("; "));
  }
  if (!result.data)
    throw new Error("GraphQL response contained neither data nor errors");
  return result.data.viewer;
}

let calls = 0;
const responses = [
  { data: { viewer: { id: "v-1", login: "ada" } } },
  { errors: [{ message: "viewer unavailable" }] },
  { data: null, errors: [{ message: "viewer unavailable" }] },
];
const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(async () => {
    calls += 1;
    return Response.json(responses[calls - 1], { status: 200 });
  }),
);
const viewer = await loadViewer(client);
const graphQlErrors: string[] = [];
for (let attempt = 0; attempt < 2; attempt += 1) {
  try {
    await loadViewer(client);
  } catch (error) {
    graphQlErrors.push(error instanceof Error ? error.message : String(error));
  }
}
console.log(viewer?.login, ...graphQlErrors);
// #endregion
