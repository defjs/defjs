// #region example
import { useEffect, useState } from "react";
import { useClient } from "@defjs/react";
import { getOrder } from "../sdk/orders.ts";

export function OrderCard({ id }: { id: number }) {
  const client = useClient();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void getOrder(client({ signal: controller.signal }), { id }).then(
      ([error, order]) => {
        if (!error) setStatus(order.status);
      },
    );
    return () => controller.abort();
  }, [client, id]);

  return <span>{status ?? "loading"}</span>;
}
// #endregion
