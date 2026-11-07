// #region example
import { defineRequest, struct } from "@defjs/core";

const VIEWER_QUERY = "query Viewer { viewer { id login } }" as const;

export const runViewer = defineRequest({
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
// #endregion
