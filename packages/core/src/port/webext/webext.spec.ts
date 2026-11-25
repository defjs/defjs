import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withRetry,
} from "../../index";
import {
  beforeEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
} from "vitest";
import { fixture } from "../../../test/fixture/client-auto.ts";
import {
  attachPortHost,
  createPortHTTPHandle,
  withPortTransport,
} from "../index";
import { fromWebExtPort, type WebExtEvent, type WebExtPort } from "./index";

function createWebExtEvent<T extends (...args: never[]) => void>(): {
  readonly event: WebExtEvent<T>;
  emit: (...args: Parameters<T>) => void;
} {
  const listeners = new Set<T>();
  return {
    event: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
    },
    emit(...args) {
      for (const listener of [...listeners]) {
        listener(...args);
      }
    },
  };
}

interface StrictWebExtPair {
  readonly clientPort: WebExtPort;
  readonly hostPort: WebExtPort;
  disconnect: () => void;
}

function createStrictWebExtPair(name = "defjs-proxy"): StrictWebExtPair {
  const clientMsg = createWebExtEvent<(message: unknown) => void>();
  const clientDisc = createWebExtEvent<() => void>();
  const hostMsg = createWebExtEvent<(message: unknown) => void>();
  const hostDisc = createWebExtEvent<() => void>();
  let disconnected = false;

  const cloneJson = (message: unknown): unknown => {
    const encoded = JSON.stringify(message);
    if (encoded === undefined) {
      throw new Error("WebExtension port message must be JSON-serializable");
    }
    const parsed: unknown = JSON.parse(encoded);
    return parsed;
  };

  return {
    clientPort: {
      name,
      postMessage(message: unknown) {
        if (arguments.length > 1) {
          throw new TypeError(
            "WebExtension Port.postMessage takes only 1 argument",
          );
        }
        if (disconnected) {
          throw new Error("Attempting to use a disconnected port object");
        }
        const cloned = cloneJson(message);
        queueMicrotask(() => {
          if (!disconnected) {
            hostMsg.emit(cloned);
          }
        });
      },
      onMessage: clientMsg.event,
      onDisconnect: clientDisc.event,
    },
    hostPort: {
      name,
      postMessage(message: unknown) {
        if (arguments.length > 1) {
          throw new TypeError(
            "WebExtension Port.postMessage takes only 1 argument",
          );
        }
        if (disconnected) {
          throw new Error("Attempting to use a disconnected port object");
        }
        const cloned = cloneJson(message);
        queueMicrotask(() => {
          if (!disconnected) {
            clientMsg.emit(cloned);
          }
        });
      },
      onMessage: hostMsg.event,
      onDisconnect: hostDisc.event,
    },
    disconnect() {
      if (disconnected) {
        return;
      }
      disconnected = true;
      hostDisc.emit();
      clientDisc.emit();
    },
  };
}

describe("@defjs/core/port/webext", () => {
  let baseUrl: string;
  let token: string;

  beforeEach(() => {
    baseUrl = inject("testServerHost");
    token = inject("fixtureToken");
  });

  test("connects lazily on first operation and proxies HTTP JSON and binary payloads in json mode", async () => {
    let connectCount = 0;

    const endpoint = fromWebExtPort(() => {
      connectCount += 1;
      const pair = createStrictWebExtPair();
      const host = attachPortHost(fromWebExtPort(pair.hostPort), {
        allowedOrigins: [baseUrl],
      });
      onTestFinished(() => host.close());
      return pair.clientPort;
    });

    const uploadBinary = defineRequest({
      method: "POST",
      path: "/e2e/echo-raw",
      input: struct.arrayBuffer(),
      builder: (body) => ({ body }),
      output: struct.object({
        bodyBase64: struct.string(),
        contentType: struct.string(),
      }),
    });

    const client = createClient(
      withEndpoint(baseUrl),
      withPortTransport(endpoint),
    );
    expect(connectCount).toBe(0);

    const bytes = new Uint8Array([0, 1, 2, 254, 255]).buffer;
    const [err, echoed] = await uploadBinary(client, bytes);
    expect(err).toBeNull();
    expect(connectCount).toBe(1);
    expect(echoed?.bodyBase64).toBe("AAEC/v8=");
    expect(endpoint.mode).toBe("json");
  });

  test("reconnects automatically across MV3 Service Worker hibernation for HTTP retries, SSE Last-Event-ID, and WebSocket", async () => {
    const f = fixture(baseUrl, token);
    const sseUrl = await f.endpoint("sw-sse", "script", {
      plan: [
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          chunks: ["id: 1\nevent: tick\ndata: first\n\n"],
          then: "hold",
        },
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          chunks: ["id: 2\nevent: tick\ndata: second\n\n"],
          then: "end",
        },
      ],
    });
    const wsUrl = await f.endpoint("sw-ws", "ws", {
      send: [JSON.stringify("hello")],
      end: { send: [JSON.stringify("bye")], code: 1000, reason: "done" },
    });

    let generation = 0;
    let currentPair: StrictWebExtPair | undefined;

    const endpoint = fromWebExtPort(() => {
      generation += 1;
      const pair = createStrictWebExtPair();
      currentPair = pair;
      const host = attachPortHost(fromWebExtPort(pair.hostPort), {
        allowedOrigins: [baseUrl],
      });
      onTestFinished(() => host.close());
      return pair.clientPort;
    });

    const client = createClient(
      withEndpoint(baseUrl),
      withPortTransport(endpoint),
      withRetry({ maxRetries: 2, delayMs: 5, jitter: 0 }),
    );

    const streamOp = defineEventStream({
      path: `${new URL(sseUrl).pathname}/s`,
      events: { tick: struct.string() },
    });

    const [sseErr, stream] = await streamOp(client);
    expect(sseErr).toBeNull();
    if (stream === undefined) {
      throw new Error("Expected SSE stream");
    }

    const received: string[] = [];
    for await (const msg of stream) {
      received.push(msg.data);
      if (msg.data === "first") {
        // Simulate MV3 Service Worker terminating idle connection mid-stream.
        currentPair?.disconnect();
      }
    }
    expect(received).toEqual(["first", "second"]);
    expect(generation).toBe(2);

    const log = await f.log();
    expect(log.requests[1]?.headers["last-event-id"]).toBe("1");

    const wsOp = defineWebSocket({
      path: `${new URL(wsUrl).pathname}/socket`,
      incoming: struct.string(),
    });
    const [wsErr, session] = await wsOp(client);
    expect(wsErr).toBeNull();
    if (session === undefined) {
      throw new Error("Expected WebSocket session");
    }

    const frames: string[] = [];
    let disconnectedWs = false;
    for await (const frame of session.receive) {
      frames.push(frame);
      if (frame === "hello" && !disconnectedWs) {
        disconnectedWs = true;
        currentPair?.disconnect();
      } else if (frame === "hello") {
        await f.act("sw-ws", "end", { request: 1 });
      } else if (frame === "bye") {
        session.close(1000, "done");
      }
    }
    await session.closed;
    expect(frames).toEqual(["hello", "hello", "bye"]);
    expect(generation).toBe(3);
  });

  test("concrete WebExtPort attaches immediately, allows listener unsubscribe, and does not reconnect after disconnect", async () => {
    const pair = createStrictWebExtPair("concrete");
    const host = attachPortHost(fromWebExtPort(pair.hostPort), {
      allowAnyOrigin: true,
    });
    onTestFinished(() => host.close());

    const concreteEndpoint = fromWebExtPort(pair.clientPort, { mode: "json" });
    const seen: unknown[] = [];
    const unsubMsg = concreteEndpoint.onMessage((data) => {
      seen.push(data);
    });
    let disconnects = 0;
    const unsubDisc = concreteEndpoint.onDisconnect?.(() => {
      disconnects += 1;
    });

    const fetchFn = createPortHTTPHandle(concreteEndpoint);
    const res = await fetchFn(`${baseUrl}/e2e/in/text`);
    expect(await res.text()).toBe("hello-text");
    expect(seen.length).toBeGreaterThan(0);

    const countBeforeUnsub = seen.length;
    unsubMsg();
    pair.disconnect();
    expect(disconnects).toBe(1);
    unsubDisc?.();

    await expect(fetchFn(`${baseUrl}/e2e/in/text`)).rejects.toThrow(
      "WebExtension port is disconnected",
    );
    expect(() => concreteEndpoint.postMessage({ v: 1 })).toThrow(
      "WebExtension port is disconnected",
    );
    expect(seen.length).toBe(countBeforeUnsub);
  });
});
