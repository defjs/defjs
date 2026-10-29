// #region example
import { defineRequest, struct } from "@defjs/core";

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

const command = createUser({
  organizationId: "acme",
  notify: true,
  requestId: "request-42",
  user: { displayName: "Ada" },
});
void command;
// #endregion
