// #region example
import { defineWebSocket, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect } from "react";

const quotes = defineWebSocket({
  path: "/quotes",
  incoming: struct.object({
    symbol: struct.string(),
    price: struct.number(),
  }),
});

export function QuoteTicker() {
  const client = useClient();

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const [error, session] = await quotes(
        client({ signal: controller.signal }),
      );
      if (error) {
        if (error.code !== "NET_ABORTED") console.error(error.code);
        return;
      }
      await using owned = session;

      try {
        for await (const message of owned.receive) {
          console.info(message.symbol, message.price);
        }
      } catch (cause) {
        // Aborting `controller` ends the session and rejects `receive` with AbortError; only report real failures.
        if (!controller.signal.aborted) console.error("quotes failed", cause);
      }
    })();

    return () => controller.abort();
  }, [client]);

  return null;
}
// #endregion
