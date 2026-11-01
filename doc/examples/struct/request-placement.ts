// #region example
import { defineRequest, struct, type Client } from "@defjs/core";

const createUser = defineRequest({
  method: "POST",
  path: "/organizations/:organizationId/users",
  input: struct.object({
    organizationId: struct.string(),
    notify: struct.boolean().optional(),
    requestId: struct.string(),
    user: struct.object({
      displayName: struct.string().alias("display_name"),
    }),
  }),
  builder: (input) => ({
    path: { organizationId: input.organizationId },
    query: { notify: input.notify },
    headers: { "x-request-id": input.requestId },
    body: input.user,
  }),
});

async function submit(client: Client) {
  const [error] = await createUser(client, {
    organizationId: "acme",
    notify: true,
    requestId: "request-42",
    user: { displayName: "Ada" },
  });
  if (error) return;
}

void submit;
// #endregion
