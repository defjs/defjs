// #region example
import { defineRequest, struct } from "@defjs/core";
import { useCallback } from "react";
import { useClient } from "@defjs/react";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ status: struct.string() }),
});

export function useOrderQueryFn(id: number) {
  const client = useClient();

  return useCallback(
    async ({ signal }: { signal: AbortSignal }) => {
      const [error, order] = await getOrder(client({ signal }), { id });
      // Query libraries record a failure when the query function rejects.
      if (error) throw error;
      return order;
    },
    [client, id],
  );
}
// #endregion
