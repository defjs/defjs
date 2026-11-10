import { createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { expect, onTestFinished, test } from "vitest";
import { WebSocket } from "ws";
import { createClient } from "../../src/client/client";
import {
  withEndpoint,
  withWebSocketHandle,
  withWebSocketReconnect,
} from "../../src/client/option";
import { struct } from "../../src/struct";
import { defineWebSocket } from "../../src/web_socket/web_socket";

const echo = defineWebSocket({
  path: "/ws",
  incoming: struct.unknown(),
});

async function silentServer(): Promise<{
  origin: string;
  accepted: Promise<Socket>;
}> {
  const server: Server = createServer();
  const sockets = new Set<Socket>();
  const accepted = new Promise<Socket>((resolve) => {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("error", () => undefined);
      resolve(socket);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  return { origin: `http://127.0.0.1:${address.port}`, accepted };
}

// Records an error that ws emits while nothing listens; ws would throw it from process.nextTick.
function observedSocketClass(options: { failBinaryType?: boolean } = {}) {
  const unobserved: unknown[] = [];
  const instances: Array<{ closed: Promise<unknown> }> = [];
  class Observed extends WebSocket {
    readonly closed: Promise<unknown>;
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.closed = new Promise((resolve) => this.once("close", resolve));
      instances.push(this);
      if (options.failBinaryType) {
        Object.defineProperty(this, "binaryType", {
          get: () => "nodebuffer",
          set: () => {
            throw new Error("binaryType rejected");
          },
        });
      }
    }
    override emit(event: string | symbol, ...args: unknown[]): boolean {
      if (event === "error" && this.listenerCount("error") === 0) {
        unobserved.push(args[0]);
        return false;
      }
      return super.emit(event, ...args);
    }
  }
  return { Observed, instances, unobserved };
}

export function registerWsHandleHandshakeSuite(): void {
  test("aborting a pending ws handshake leaves an error listener for the late error", async () => {
    const { origin, accepted } = await silentServer();
    const { Observed, instances, unobserved } = observedSocketClass();
    const controller = new AbortController();
    const pending = echo(
      createClient(
        withEndpoint(origin),
        withWebSocketHandle(Observed),
      )({ signal: controller.signal }),
    );
    await accepted;
    controller.abort();
    const [error, session] = await pending;
    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(session).toBeUndefined();
    await instances[0]?.closed;
    expect(unobserved).toEqual([]);
  });

  test("a ws handshake that times out leaves an error listener for the late error", async () => {
    const { origin } = await silentServer();
    const { Observed, instances, unobserved } = observedSocketClass();
    const [error] = await echo(
      createClient(
        withEndpoint(origin),
        withWebSocketHandle(Observed),
        withWebSocketReconnect({ attempts: 0, connectTimeoutMs: 50 }),
      )(),
    );
    expect(error).toMatchObject({ code: "NET_TIMEOUT" });
    await instances[0]?.closed;
    expect(unobserved).toEqual([]);
  });

  test("a ws handle whose binaryType setter throws is closed with an error listener in place", async () => {
    const { origin } = await silentServer();
    const { Observed, instances, unobserved } = observedSocketClass({
      failBinaryType: true,
    });
    const [error] = await echo(
      createClient(withEndpoint(origin), withWebSocketHandle(Observed))(),
    );
    expect(error).toMatchObject({ code: "NET_UNREACHABLE" });
    await instances[0]?.closed;
    expect(unobserved).toEqual([]);
  });
}
