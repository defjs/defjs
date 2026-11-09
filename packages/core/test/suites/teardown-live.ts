import { Hono } from "hono";
import { connect } from "node:net";
import { expect, test } from "vitest";
import { createFixtureApp } from "../fixture/app.ts";
import { createFixtureClient } from "../fixture/client.ts";
import { createFixtureLifecycle } from "../fixture/lifecycle.ts";
import { selectStartup } from "../fixture/startup.ts";

const partialHead = "GET /__fixture/x/raw/truncated HTTP/1.1\r\nHost: x\r\n";

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function required(value: string | undefined, key: string): string {
  if (value === undefined) {
    throw new Error(`fixture lifecycle did not provide ${key}`);
  }
  return value;
}

export function registerTeardownLiveSuite(): void {
  test("teardown closes a hanging request, a held raw socket and an open WebSocket within the deadline", async () => {
    const reached = defer();
    const lifecycle = createFixtureLifecycle({
      selectStartup,
      createApp(deps) {
        const app = new Hono();
        app.get("/hang", () => {
          reached.resolve();
          return new Promise<Response>(() => undefined);
        });
        app.get(
          "/ws",
          deps.upgradeWebSocket(() => ({})),
        );
        return app;
      },
      createToken: () => crypto.randomUUID(),
      closeTimeoutMs: 10_000,
    });
    const provided = new Map<string, string>();
    let webSocket: WebSocket | undefined;
    let rawSocket: ReturnType<typeof connect> | undefined;
    try {
      await lifecycle.setup({
        name: "core-test",
        provide(key, value) {
          if (typeof value === "string") provided.set(key, value);
        },
      });
      const host = required(provided.get("testServerHost"), "testServerHost");
      const rawOrigin = required(
        provided.get("rawServerOrigin"),
        "rawServerOrigin",
      );
      const rawUrl = new URL(rawOrigin);
      const port = Number(rawUrl.port);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error("raw origin has no TCP port");
      }

      const hang = fetch(`${host}/hang`).then(
        () => "fulfilled" as const,
        () => "rejected" as const,
      );
      const endpoint = new URL(host);
      endpoint.protocol = "ws:";
      endpoint.pathname = "/ws";
      webSocket = new WebSocket(endpoint);
      const opened = new Promise<void>((resolve, reject) => {
        webSocket?.addEventListener("open", () => resolve(), { once: true });
        webSocket?.addEventListener(
          "error",
          () => reject(new Error("WebSocket failed to open")),
          { once: true },
        );
      });
      const webSocketClosed = new Promise<void>((resolve) => {
        webSocket?.addEventListener("close", () => resolve(), { once: true });
      });
      rawSocket = connect({ host: "127.0.0.1", port });
      rawSocket.on("error", () => undefined);
      const rawClosed = new Promise<void>((resolve) => {
        rawSocket?.on("close", () => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        rawSocket?.once("connect", () => resolve());
        rawSocket?.once("error", reject);
      });
      rawSocket.write(partialHead);

      await reached.promise;
      await opened;
      await expect(lifecycle.teardown()).resolves.toBeUndefined();
      expect(await hang).toBe("rejected");
      await webSocketClosed;
      expect(webSocket.readyState).toBe(WebSocket.CLOSED);
      await rawClosed;
    } finally {
      rawSocket?.destroy();
      webSocket?.close();
      await lifecycle.teardown();
    }
  });

  test("teardown completes with a held hang request, a held raw socket and an open WebSocket", async () => {
    const lifecycle = createFixtureLifecycle({
      selectStartup,
      createApp: createFixtureApp,
      createToken: () => crypto.randomUUID(),
      closeTimeoutMs: 10_000,
    });
    const provided = new Map<string, string>();
    let webSocket: WebSocket | undefined;
    try {
      await lifecycle.setup({
        name: "core-test",
        provide(key, value) {
          if (typeof value === "string") provided.set(key, value);
        },
      });
      const host = required(provided.get("testServerHost"), "testServerHost");
      const rawOrigin = required(
        provided.get("rawServerOrigin"),
        "rawServerOrigin",
      );
      const token = required(provided.get("fixtureToken"), "fixtureToken");
      const client = createFixtureClient(host, token);
      const base = await client.endpoint("slow", "hang", {});
      const sock = await client.endpoint("sock", "ws", { send: [] });
      const pending = fetch(`${base}/slow`).then(
        () => "settled",
        () => "settled",
      );
      await client.log({ wait: 1 });

      webSocket = new WebSocket(`${sock.replace(/^http/, "ws")}/ws`);
      const socket = webSocket;
      const opened = new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket failed to open")),
          { once: true },
        );
      });
      const webSocketClosed = new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
      });
      await opened;

      const response = await fetch(
        client.rawUrl(rawOrigin, "partial-frame-resume", "events"),
      );
      const body = response.body;
      if (body === null) throw new Error("missing body");
      const reader = body.getReader();
      const openedChunk = await reader.read();
      if (openedChunk.done || openedChunk.value === undefined) {
        throw new Error("missing chunk");
      }
      expect(new TextDecoder().decode(openedChunk.value)).toBe(
        "id: 1\ndata: first\n\nid: 2\n",
      );

      await expect(lifecycle.teardown()).resolves.toBeUndefined();
      expect(await pending).toBe("settled");
      await webSocketClosed;
      expect(socket.readyState).toBe(WebSocket.CLOSED);
      await expect(reader.read()).rejects.toThrow();
    } finally {
      webSocket?.close();
      await lifecycle.teardown();
    }
  });
}
