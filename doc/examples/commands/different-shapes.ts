// #region example
import { defineRequest, struct } from "@defjs/core";

const search = defineRequest({
  method: "GET",
  path: "/orgs/:org_id/users",
  input: struct.object({
    orgId: struct.number(),
    filter: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias("page_size"),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.filter,
    headers: { "x-api-version": "2" },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
});
void search;
// #endregion
