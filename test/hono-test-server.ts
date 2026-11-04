import type { Hono } from "hono";
import { websocket } from "hono/bun";

export interface HonoTestServer {
  host: string;
  close(): Promise<void>;
}

/**
 * Starts a fixture server on Bun. Routes that upgrade to a WebSocket use
 * `upgradeWebSocket` from `hono/bun`, which pairs with the handler passed here.
 */
export function startHonoTestServer(app: Hono): Promise<HonoTestServer> {
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0,
    websocket,
  });
  server.unref();

  let closed = false;
  return Promise.resolve({
    host: `http://127.0.0.1:${server.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await server.stop(true);
    },
  });
}
