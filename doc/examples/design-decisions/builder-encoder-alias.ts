// #region example
import { defineRequest, struct } from "@defjs/core";

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

const command = createBatch({
  accountId: 42,
  users: [{ displayName: "Ada", email: "ada@example.com" }],
});
void command;
// #endregion
