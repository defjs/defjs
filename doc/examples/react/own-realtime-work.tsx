// #region example
import { defineWebSocket, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect } from "react";

const quotes = defineWebSocket({
  maxIncomingQueueSize: 100,
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
    let disposed = false;
    let closeActive: (() => void) | undefined;

    void (async () => {
      const [error, session] = await quotes(
        client({ signal: controller.signal }),
      );
      if (error) return;

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        session.close(1000, "effect-disposed");
      };
      closeActive = close;

      if (disposed) {
        close();
        await session.closed;
        return;
      }

      try {
        for await (const message of session.receive) {
          console.info(message.symbol, message.price);
        }
      } catch (cause) {
        // Aborting `controller` ends the session and rejects `receive` with AbortError; only report real failures.
        if (!disposed) console.error("quotes failed", cause);
      } finally {
        close();
        await session.closed;
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      closeActive?.();
    };
  }, [client]);

  return null;
}
// #endregion
