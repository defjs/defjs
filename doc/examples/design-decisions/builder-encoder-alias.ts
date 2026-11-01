// #region example
import { defineRequest, struct, type Client } from "@defjs/core";

const createBatch = defineRequest({
  method: "POST",
  path: "/accounts/:account_id/users",
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(
      struct.object({
        displayName: struct.string().alias("display_name"),
        email: struct.string(),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { "x-api-version": "2" },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
});

async function submit(client: Client) {
  const [error, result] = await createBatch(client, {
    accountId: 42,
    users: [{ displayName: "Ada", email: "ada@example.com" }],
  });
  if (error) return;
  console.log(result.accepted);
}

void submit;
// #endregion
