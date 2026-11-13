import { Hono } from "hono";
import { connect } from "node:net";
import { expect, test } from "vitest";
import { selectStartup, type StartedServer } from "../fixture/startup.ts";
import type { RawReply, RawRequestHead } from "../fixture/types.ts";

const expected = process.versions.bun === undefined ? "node" : "bun";
const loopbackOrigin = /^http:\/\/127\.0\.0\.1:\d+$/;

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

async function withServer(
  start: () => Promise<StartedServer>,
  run: (server: StartedServer) => Promise<void>,
): Promise<void> {
  const server = await start();
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

function outcome(promise: Promise<unknown>): Promise<"fulfilled" | "rejected"> {
  return promise.then(
    () => "fulfilled",
    () => "rejected",
  );
}

function portOf(origin: string): number {
  const port = Number(new URL(origin).port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("HTTP origin has no TCP port");
  }
  return port;
}

function latin1(chunk: Uint8Array): string {
  let text = "";
  for (const byte of chunk) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function readUntilSocketEnds(port: number, request: string): Promise<string> {
  const socket = connect({ host: "127.0.0.1", port });
  return new Promise((resolve, reject) => {
    let received = "";
    const fail = (error: unknown): void => {
      socket.destroy();
      reject(error instanceof Error ? error : new Error("socket failed"));
    };
    socket.on("data", (chunk) => {
      if (typeof chunk === "string") {
        received += chunk;
        return;
      }
      received += latin1(chunk);
    });
    socket.once("error", fail);
    socket.once("end", () => {
      socket.destroy();
      resolve(received);
    });
    socket.once("connect", () => {
      socket.write(request);
    });
  });
}

export function registerFixtureStartupSuite(): void {
  test("reports its runtime", async () => {
    const layer = await selectStartup();
    expect(layer.runtime).toBe(expected);
  });

  test("startHttp serves the app on a loopback origin", async () => {
    const layer = await selectStartup();
    const app = new Hono();
    app.get("/ping", (c) => c.text("pong"));
    await withServer(
      () => layer.startHttp(app),
      async (server) => {
        expect(server.origin).toMatch(loopbackOrigin);
        const response = await fetch(`${server.origin}/ping`);
        expect(await response.text()).toBe("pong");
      },
    );
  });

  test("startHttp sends connection close and the response body", async () => {
    const layer = await selectStartup();
    const app = new Hono();
    app.get("/ping", (c) => c.text("pong"));
    await withServer(
      () => layer.startHttp(app),
      async (server) => {
        const raw = await readUntilSocketEnds(
          portOf(server.origin),
          "GET /ping HTTP/1.1\r\nHost: x\r\n\r\n",
        );
        const splitAt = raw.indexOf("\r\n\r\n");
        expect(splitAt).toBeGreaterThan(0);
        expect(raw.slice(0, splitAt).toLowerCase().split("\r\n")).toContain(
          "connection: close",
        );
        expect(raw.slice(splitAt + 4)).toContain("pong");
      },
    );
  });

  test("startHttp delivers the first chunk and then fails the body read when the stream errors", async () => {
    const layer = await selectStartup();
    const app = new Hono();
    const cut = Promise.withResolvers<void>();
    app.get("/cut", () => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(bytes("first"));
              return;
            }
            return cut.promise.then(() => {
              controller.error(new Error("cut"));
            });
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body);
    });
    await withServer(
      () => layer.startHttp(app),
      async (server) => {
        const response = await fetch(`${server.origin}/cut`);
        expect(response.status).toBe(200);
        const reader = response.body?.getReader();
        if (reader === undefined) {
          throw new Error("expected a response body");
        }
        const first = await reader.read();
        expect(first.done).toBe(false);
        if (first.value === undefined) {
          throw new Error("expected the first chunk");
        }
        expect(latin1(first.value)).toBe("first");
        cut.resolve();
        await expect(reader.read()).rejects.toThrow();
      },
    );
  });

  test("startHttp serves a redirect with its location", async () => {
    const layer = await selectStartup();
    const app = new Hono();
    app.get("/go", () => Response.redirect("http://127.0.0.1/x", 302));
    await withServer(
      () => layer.startHttp(app),
      async (server) => {
        const response = await fetch(`${server.origin}/go`, {
          redirect: "manual",
        });
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("http://127.0.0.1/x");
      },
    );
  });

  test("close disconnects an upgraded WebSocket, refuses new connections and is idempotent", async () => {
    const layer = await selectStartup();
    const app = new Hono();
    app.get(
      "/ws",
      layer.upgradeWebSocket(() => ({
        onMessage(event, socket) {
          socket.send(typeof event.data === "string" ? event.data : "");
        },
      })),
    );
    const server = await layer.startHttp(app);
    const socket = new WebSocket(`${server.origin.replace(/^http/, "ws")}/ws`);
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket failed to open")),
          { once: true },
        );
      });
      const echoed = new Promise<unknown>((resolve) => {
        socket.addEventListener(
          "message",
          (event) => {
            resolve(event.data);
          },
          { once: true },
        );
      });
      socket.send("probe");
      expect(await echoed).toBe("probe");
      await server.close();
      await closed;
      expect(socket.readyState).toBe(WebSocket.CLOSED);
      await expect(fetch(server.origin)).rejects.toThrow();
      await server.close();
    } finally {
      socket.close();
      await server.close();
    }
  });

  test("startRaw passes the parsed head and a connection to the handler and writes its bytes", async () => {
    const layer = await selectStartup();
    let seen: RawRequestHead | undefined;
    await withServer(
      () =>
        layer.startRaw((head) => {
          seen = head;
          return {
            bytes: bytes(
              "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok",
            ),
            then: "end",
          };
        }),
      async (server) => {
        const response = await fetch(`${server.origin}/probe?x=1`, {
          headers: { "x-probe": "1" },
        });
        expect(await response.text()).toBe("ok");
        expect(seen?.method).toBe("GET");
        expect(seen?.target).toBe("/probe?x=1");
        expect(seen?.headers["x-probe"]).toBe("1");
        expect(seen?.rawHead.startsWith("GET /probe?x=1 HTTP/1.1\r\n")).toBe(
          true,
        );
        expect(typeof seen?.connection.terminate).toBe("function");
      },
    );
  });

  test("startRaw terminate resets the connection", async () => {
    const layer = await selectStartup();
    const reply: RawReply = {
      bytes: bytes("HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\nab"),
      then: "terminate",
    };
    await withServer(
      () => layer.startRaw(() => reply),
      async (server) => {
        const response = await fetch(server.origin);
        await expect(response.text()).rejects.toThrow();
      },
    );
  });

  test("startRaw closes a request it cannot understand", async () => {
    const layer = await selectStartup();
    await withServer(
      () => layer.startRaw(() => undefined),
      async (server) => {
        await expect(fetch(server.origin)).rejects.toThrow();
      },
    );
  });

  test("close terminates a held raw connection", async () => {
    const layer = await selectStartup();
    let markCalled: () => void = () => undefined;
    const called = new Promise<void>((resolve) => {
      markCalled = resolve;
    });
    const server = await layer.startRaw(() => {
      markCalled();
      return {
        bytes: bytes("HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\n"),
        then: "hold",
      };
    });
    const pending = outcome(
      fetch(server.origin).then((response) => response.text()),
    );
    try {
      await called;
      await server.close();
      await expect(pending).resolves.toBe("rejected");
      await server.close();
    } finally {
      await server.close();
    }
  });

  test("reserveRefusedOrigin returns a closed loopback port", async () => {
    const layer = await selectStartup();
    const origin = await layer.reserveRefusedOrigin();
    expect(origin).toMatch(loopbackOrigin);
    await expect(fetch(origin)).rejects.toThrow();
  });
}
