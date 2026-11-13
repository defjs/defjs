import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { UpgradeWebSocket } from "hono/ws";
import { registerBodyRoutes } from "../body-routes.ts";
import { registerControlPlane } from "./control-plane.ts";
import { registerDataPlane } from "./data-plane.ts";
import { registerE2eProbe, registerE2eRoutes } from "../e2e-routes.ts";
import { registerXsrfRoutes } from "../xsrf-middleware.ts";
import type { FixtureRegistry } from "./state.ts";

export const LEGACY_FIXTURE_ID = "legacy";

// A close frame already buffered at the handshake makes Firefox drop `open`,
// so this constant is for the routes that need the client to see `open` first.
const socketCloseAfterOpenMs = 200;

export interface FixtureAppDeps {
  upgradeWebSocket: UpgradeWebSocket;
  rawOrigin: () => string;
  registry: FixtureRegistry;
  token: string;
}

export function createFixtureApp(deps: FixtureAppDeps): Hono {
  const redirectStatuses = [
    300, 301, 302, 303, 304, 305, 306, 307, 308,
  ] as const;

  function frameText(data: unknown): string {
    if (typeof data !== "string") {
      throw new TypeError("Expected a text WebSocket frame");
    }
    return data;
  }

  function parseFrameObject(data: unknown): Record<string, unknown> {
    const decoded: unknown = JSON.parse(frameText(data));
    if (typeof decoded !== "object" || decoded === null) {
      throw new TypeError("Expected a JSON object frame");
    }
    return Object.fromEntries(Object.entries(decoded));
  }

  const providerEnvelopeAttempts = new Map<string, number>();
  const sseDropStreams = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();

  function releaseSseDropStreams(): void {
    for (const controller of sseDropStreams.values()) {
      try {
        controller.error(new Error("test server stopped"));
      } catch {
        // Already closed by the client.
      }
    }
    sseDropStreams.clear();
  }

  const legacy = deps.registry.create(LEGACY_FIXTURE_ID);
  legacy.onDispose(releaseSseDropStreams);

  const app = new Hono();
  registerE2eProbe(app);
  registerXsrfRoutes(app);
  const reconnectAttempts = new Map<string, number>();

  const delay = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || signal?.aborted) {
        resolve();
        return;
      }

      const timeout = setTimeout(done, ms);
      timeout.unref?.();

      function done() {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", done);
        resolve();
      }

      signal?.addEventListener("abort", done, { once: true });
    });

  function createSocketMessage(type: string, payload: unknown): string {
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload)
    ) {
      return JSON.stringify({
        type,
        ...payload,
      });
    }

    return JSON.stringify({
      data: payload,
      type,
    });
  }

  registerControlPlane(app, {
    registry: deps.registry,
    token: deps.token,
    logWaitCapMs: 10_000,
  });
  registerDataPlane(app, {
    registry: deps.registry,
    token: deps.token,
    upgradeWebSocket: deps.upgradeWebSocket,
  });

  app.use(
    "*",
    cors({
      origin(origin) {
        return origin || "*";
      },
      allowHeaders: ["*", "Accept", "Content-Type", "Last-Event-ID"],
      allowMethods: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ],
      credentials: true,
      exposeHeaders: ["x-request-id"],
      maxAge: 86_400,
    }),
  );

  app.get("/", (c) => c.body(null, 200));

  app.post("/", async (c) => {
    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return c.json(await c.req.json());
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("text/plain")
    ) {
      return c.text(await c.req.text());
    }

    return c.body(await c.req.arrayBuffer(), {
      status: 200,
      headers: contentType ? { "content-type": contentType } : undefined,
    });
  });

  app.post("/json/alias", async (c) => {
    const body = await c.req.json<{ user_name?: unknown }>();
    return c.json({ user_name: body.user_name });
  });

  app.get("/text", (c) => c.text("Hello World!"));
  app.get("/json", (c) => c.json({ id: 1 }));
  app.get("/balancer/bad/replica", (c) => c.body(null, 503));
  app.get("/balancer/good/replica", (c) => c.body(null, 200));
  app.get("/json/malformed-error", (c) =>
    c.body("{not-json}", {
      headers: { "content-type": "application/json" },
      status: 500,
    }),
  );
  app.get("/null", (c) => c.body(null, 200));
  app.get("/no-content-type", (c) => {
    c.header("content-type", "");
    return c.body("hello", 200);
  });
  app.get("/500", (c) => c.body(null, { status: 500 }));
  app.on("HEAD", "/head", (c) => c.body(null, { status: 204 }));
  app.post("/account", (c) => c.json({ id: 1, name: "Jack" }));
  app.get("/account/not-found", (c) =>
    c.json({ code: "ACCOUNT_NOT_FOUND", message: "Account not found" }, 404),
  );

  app.get("/delay", async (c) => {
    await delay(Number(c.req.query("ms") ?? "0"), c.req.raw.signal);
    return c.body(null, 200);
  });

  // After the cors middleware above, so browsers may read these cross-origin.
  registerBodyRoutes(app, {
    truncatedUrl: () =>
      `${deps.rawOrigin()}/__fixture/${LEGACY_FIXTURE_ID}/raw/truncated`,
  });

  const basicSSEHandler = (c: Context) => {
    c.header("x-request-id", "trace-sse-basic");
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: "first",
        event: "message",
        id: "1",
      });

      await stream.writeSSE({
        data: "second line 1\nsecond line 2",
        event: "message",
        id: "2",
      });
    });
  };

  app.get("/sse/basic", basicSSEHandler);
  app.post("/sse/basic", basicSSEHandler);
  app.post("/sse/redirect/:status", (c) => {
    const status = redirectStatuses.find(
      (candidate) => candidate === Number(c.req.param("status")),
    );
    return status === undefined
      ? c.text("unsupported redirect status", 400)
      : c.redirect("/sse/basic", status);
  });

  app.get("/sse/retry", (c) => {
    const lastEventId = c.req.header("last-event-id");

    if (lastEventId === "1") {
      c.header("x-request-id", "trace-sse-retry-2");
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: "second",
          event: "message",
          id: "2",
        });
      });
    }

    c.header("x-request-id", "trace-sse-retry-1");
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: "first",
        event: "message",
        id: "1",
        retry: 100,
      });
    });
  });

  app.get("/sse/slow", async (c) => {
    // Outlasts any test budget: the handler ends early when the request signal aborts.
    await delay(10_000, c.req.raw.signal);
    return c.body(null, 500);
  });

  const sseDropAttempts = new Map<string, number>();
  const sseRetryAttempts = new Map<string, number>();

  // The first attempt stays open until the test has read "partial" and calls the
  // cut route. Erroring the stream aborts the chunked body without its terminator,
  // so the client sees a read failure. Cutting earlier races the unread stream
  // queue under load.
  app.get("/sse/drop", (c) => {
    const key = c.req.query("key") ?? "default";
    const attempt = (sseDropAttempts.get(key) ?? 0) + 1;
    sseDropAttempts.set(key, attempt);
    if (attempt > 1) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ data: "resumed", event: "message", id: "2" });
      });
    }

    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode("event: message\ndata: partial\nid: 1\n\n"),
          );
          sseDropStreams.set(key, controller);
        },
      }),
      {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        },
      },
    );
  });

  app.post("/sse/drop/cut", (c) => {
    const key = c.req.query("key") ?? "default";
    const controller = sseDropStreams.get(key);
    sseDropStreams.delete(key);
    try {
      controller?.error(new Error("dropped"));
    } catch {
      // Already closed by the client.
    }
    return c.body(null, 204);
  });

  app.get("/sse/500-once", (c) => {
    const key = c.req.query("key") ?? "default";
    const attempt = (sseRetryAttempts.get(key) ?? 0) + 1;
    sseRetryAttempts.set(key, attempt);

    if (attempt === 1) {
      return c.body(null, 500);
    }

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: "ok", event: "message", id: "1" });
    });
  });

  app.get("/sse/500-always", (c) => c.body(null, 500));

  app.get("/sse/no-id", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: "no-id-message",
        event: "message",
      });
    });
  });

  app.get("/sse/empty-id", (c) => {
    c.header("content-type", "text/event-stream");
    return streamSSE(c, async (stream) => {
      const encoder = new TextEncoder();
      await stream.write(
        encoder.encode("data: hello\nid:\nevent: message\n\n"),
      );
    });
  });

  app.get("/sse/mixed", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: JSON.stringify({ uid: 1 }),
        event: "userconnect",
        id: "1",
      });
      await stream.writeSSE({
        data: JSON.stringify({ note: "default" }),
        event: "something-else",
        id: "2",
      });
    });
  });

  app.get("/sse/unknown-event", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: "hello", event: "unknown", id: "1" });
    });
  });

  app.get("/sse/empty-data", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: "", event: "message", id: "1" });
    });
  });

  app.get("/sse/no-event-name", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: "hello", id: "1" });
    });
  });

  app.get("/sse/infinite", (c) => {
    c.header("x-request-id", "trace-sse-infinite");
    const requestSignal = c.req.raw.signal;
    return streamSSE(c, async (stream) => {
      let count = 0;

      const writeTick = async () => {
        count += 1;
        await stream.writeSSE({
          data: String(count),
          event: "tick",
          id: String(count),
        });
      };

      await writeTick();

      await new Promise<void>((resolve) => {
        let settled = false;
        const interval = setInterval(() => {
          if (stream.aborted) {
            done();
            return;
          }

          void writeTick();
        }, 20);
        interval.unref?.();

        function done() {
          if (settled) {
            return;
          }

          settled = true;
          clearInterval(interval);
          requestSignal.removeEventListener("abort", done);
          resolve();
        }

        stream.onAbort(done);
        requestSignal.addEventListener("abort", done, { once: true });
        if (requestSignal.aborted) {
          done();
        }
      });
    });
  });

  registerE2eRoutes(app, deps);

  app.get(
    "/ws/basic",
    deps.upgradeWebSocket((c) => {
      const roomId = c.req.query("roomId") ?? "default";

      return {
        onOpen(_event, ws) {
          ws.send(createSocketMessage("joined", { roomId, userId: 1 }));
          setTimeout(() => {
            ws.send(
              createSocketMessage("message", {
                text: `welcome:${roomId}`,
                userId: 1,
              }),
            );
            ws.close(1000, "done");
          }, socketCloseAfterOpenMs);
        },
      };
    }),
  );

  app.get(
    "/ws/echo",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        ws.send(createSocketMessage("ready", { ok: true }));
      },
      onMessage(event, ws) {
        ws.send(
          typeof event.data === "string"
            ? event.data
            : JSON.stringify(event.data),
        );
      },
    })),
  );

  app.get(
    "/ws/invalid",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => {
          ws.send("not-json");
          ws.close(1000, "done");
        }, socketCloseAfterOpenMs);
      },
    })),
  );

  app.get(
    "/ws/before-connect",
    deps.upgradeWebSocket((c) => {
      const token = c.req.query("token") ?? "missing";

      return {
        onOpen(_event, ws) {
          ws.send(createSocketMessage("connected", { token }));
          setTimeout(() => {
            ws.close(1000, "done");
          }, socketCloseAfterOpenMs);
        },
      };
    }),
  );

  app.get(
    "/ws/reconnect",
    deps.upgradeWebSocket((c) => {
      const key = c.req.query("key") ?? "default";
      const attempt = (reconnectAttempts.get(key) ?? 0) + 1;
      reconnectAttempts.set(key, attempt);

      return {
        onOpen(_event, ws) {
          if (attempt === 1) {
            // A close frame in the opening burst makes Firefox drop `open`, so the
            // client must prove it saw the open.
            return;
          }

          ws.send(createSocketMessage("reconnected", { attempt }));
        },
        onMessage(event, ws) {
          if (attempt === 1) {
            ws.close(1012, "restart");
            return;
          }

          ws.send(
            typeof event.data === "string"
              ? event.data
              : JSON.stringify(event.data),
          );
        },
      };
    }),
  );

  app.get(
    "/ws/provider-envelopes",
    deps.upgradeWebSocket((c) => {
      const key = c.req.query("key") ?? "default";
      const mode = c.req.query("mode") ?? "default";
      const attempt = (providerEnvelopeAttempts.get(key) ?? 0) + 1;
      providerEnvelopeAttempts.set(key, attempt);

      return {
        onClose() {
          if (mode === "queue" && attempt === 1) {
            return;
          }
          providerEnvelopeAttempts.delete(key);
        },
        onMessage(event, ws) {
          const decoded = parseFrameObject(event.data);
          ws.send(
            JSON.stringify({
              method: "wire",
              success: true,
              result: {
                attempt,
                hasType: Object.hasOwn(decoded, "type"),
                keys: Object.keys(decoded).sort(),
                method: decoded["method"],
                req_id: decoded["req_id"],
              },
            }),
          );

          if (decoded["method"] === "ping") {
            ws.send(
              JSON.stringify({ method: "pong", req_id: decoded["req_id"] }),
            );
          }
          if (mode === "queue" && attempt === 1) {
            ws.close(1012, "restart");
          }
        },
        onOpen(_event, ws) {
          if (mode === "queue" && attempt === 1) {
            ws.send(
              JSON.stringify({
                method: "subscribe",
                success: true,
                result: { channel: "ticker" },
              }),
            );
            ws.send(JSON.stringify({ channel: "heartbeat" }));
            ws.send(
              JSON.stringify({
                channel: "ticker",
                type: "update",
                data: [{ symbol: "BTC/USD", last: 1 }],
              }),
            );
            return;
          }
          if (attempt > 1 || mode === "heartbeat") {
            ws.send(JSON.stringify({ channel: "heartbeat" }));
          }
        },
      };
    }),
  );

  app.get(
    "/ws/heartbeat",
    deps.upgradeWebSocket(() => ({
      onMessage(event, ws) {
        try {
          const decoded = parseFrameObject(event.data);
          if (decoded["type"] === "ping") {
            ws.send(createSocketMessage("pong", { ok: true }));
            ws.close(1000, "heartbeat-ok");
          }
        } catch {
          // noop
        }
      },
    })),
  );

  app.get(
    "/ws/heartbeat-silent",
    deps.upgradeWebSocket(() => ({
      // Intentionally silent — used to test heartbeat timeout on the client side.
      onMessage() {
        /* intentionally empty */
      },
    })),
  );

  app.get(
    "/ws/close-immediately",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        ws.close(1000, "bye");
      },
    })),
  );

  app.get(
    "/ws/error-before-close",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => {
          ws.send(createSocketMessage("message", { text: 123 }));
          ws.close(1000, "done");
        }, socketCloseAfterOpenMs);
      },
    })),
  );

  app.get(
    "/ws/unknown-message",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => {
          ws.send(createSocketMessage("unknown", { note: "skip-me" }));
          ws.close(1000, "done");
        }, socketCloseAfterOpenMs);
      },
    })),
  );

  app.get(
    "/ws/binary",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        ws.send(
          new TextEncoder().encode(
            JSON.stringify({ type: "message", text: "hello-binary" }),
          ),
        );
        setTimeout(() => {
          ws.close(1000, "done");
        }, socketCloseAfterOpenMs);
      },
    })),
  );

  // Preserve the original 10ms closes independently of the padded browser fixtures.
  app.get(
    "/ws/regression/error-before-close",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        setTimeout(() => {
          socket.send(JSON.stringify({ type: "message", text: 123 }));
          socket.close(1000, "done");
        }, 10);
      },
    })),
  );
  app.get(
    "/ws/regression/binary",
    deps.upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        socket.send(
          new TextEncoder().encode(
            JSON.stringify({ type: "message", text: "hello-binary" }),
          ),
        );
        setTimeout(() => {
          socket.close(1000, "done");
        }, 10);
      },
    })),
  );
  app.get(
    "/ws/regression/capture",
    deps.upgradeWebSocket(() => ({
      onMessage(event, socket) {
        socket.send(JSON.stringify({ received: frameText(event.data) }));
      },
    })),
  );

  return app;
}
