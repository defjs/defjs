// #region example
import { defineRequest, struct } from "@defjs/core";
import { useCallback } from "react";
import { useClient } from "@defjs/react";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ name: struct.string() }),
});

export function useUserQueryFn(id: number) {
  const client = useClient();

  return useCallback(
    async ({ signal }: { signal: AbortSignal }) => {
      const [error, user] = await client.execute(getUser({ id }), { signal });
      if (error) throw error;
      return user;
    },
    [client, id],
  );
}
// #endregion
