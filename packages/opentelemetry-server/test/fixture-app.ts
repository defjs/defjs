import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { UpgradeWebSocket } from "hono/ws";

export function createOtelFixtureApp(deps: {
  upgradeWebSocket: UpgradeWebSocket;
}): Hono {
  const app = new Hono();

  // HTTP: echo back received headers
  app.post("/echo-headers", (c) => {
    const headers: { [key: string]: string } = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return c.json({ headers });
  });

  // HTTP: return 500 for error testing
  app.get("/500", (c) =>
    c.body(null, { status: 500, statusText: "Internal Server Error" }),
  );

  // SSE: echo back traceparent header, then close
  app.get("/sse", (c) => {
    const traceparent = c.req.header("traceparent") ?? "missing";
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: traceparent,
        event: "traceparent",
        id: "1",
      });
    });
  });

  // SSE: 500 error
  app.get("/sse/500", (c) => c.body(null, 500));

  // WebSocket: echo back traceparent query param, then close
  app.get(
    "/ws",
    deps.upgradeWebSocket((c) => {
      const traceparent = c.req.query("traceparent") ?? "missing";
      return {
        onOpen(_event, ws) {
          ws.send(JSON.stringify({ type: "traceparent", value: traceparent }));
          setTimeout(() => {
            ws.close(1000, "done");
          }, 50);
        },
      };
    }),
  );

  // WebSocket: server-initiated close with an internal-error code
  app.get(
    "/ws/1011",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => ws.close(1011, "server error"), 50);
      },
    })),
  );

  return app;
}
