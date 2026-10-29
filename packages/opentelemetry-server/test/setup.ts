import { upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { TestProject } from "vitest/node";
import { WebSocketServer } from "ws";
import {
  startHonoTestServer,
  type HonoTestServer,
} from "../../../test/hono-test-server";

declare module "vitest" {
  export interface ProvidedContext {
    testServerHost: string;
  }
}

let testServer: HonoTestServer | undefined;

export async function setup({ provide }: TestProject) {
  const app = new Hono();

  // HTTP: echo back received headers
  app.post("/echo-headers", async (c) => {
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
    upgradeWebSocket((c) => {
      const traceparent = c.req.query("traceparent") ?? "missing";
      return {
        onOpen(_event, ws) {
          ws.send(JSON.stringify({ type: "traceparent", value: traceparent }));
          setTimeout(() => {
            if (ws.readyState === 1) {
              ws.close(1000, "done");
            }
          }, 50);
        },
      };
    }),
  );

  // WebSocket: server-initiated close with an internal-error code
  app.get(
    "/ws/1011",
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => ws.close(1011, "server error"), 50);
      },
    })),
  );

  const wss = new WebSocketServer({ noServer: true });
  testServer = await startHonoTestServer(app, { websocket: { server: wss } });
  provide("testServerHost", testServer.host);
}

export async function teardown() {
  await testServer?.close();
  testServer = undefined;
}
