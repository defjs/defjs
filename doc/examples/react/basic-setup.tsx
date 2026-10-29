// #region example
import { defineRequest, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect, useState } from "react";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ name: struct.string() }),
});

export function UserName({ id }: { id: number }) {
  const client = useClient();
  const [name, setName] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    const command = getUser({ id });
    void client
      .execute(command, { signal: controller.signal })
      .then(([error, user]) => {
        if (controller.signal.aborted) return;
        if (error) {
          setName(undefined);
          return;
        }
        setName(user.name);
      });

    return () => controller.abort();
  }, [client, id]);

  return <span>{name ?? "Loading..."}</span>;
}
// #endregion
