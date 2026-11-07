// #region example
import { defineRequest, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect, useState } from "react";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ status: struct.string() }),
});

export function OrderStatus({ id }: { id: number }) {
  const client = useClient();
  const [name, setName] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    void getOrder(client({ signal: controller.signal }), { id }).then(
      ([error, order]) => {
        if (controller.signal.aborted) return;
        if (error) {
          setName(undefined);
          return;
        }
        setName(order.status);
      },
    );

    return () => controller.abort();
  }, [client, id]);

  return <span>{name ?? "Loading..."}</span>;
}
// #endregion
