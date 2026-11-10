import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withBalancer,
  withWebSocketHandle,
  withWebSocketReconnect,
} from "../client/option";
import { createControllableSocketClass } from "../../test/regression/controllable_socket";
import type { DoneInfo } from "../balancer/balancer";
import { struct } from "../struct";
import { defineWebSocket } from "./web_socket";

const endpoints = ["https://first.test", "https://second.test"];
afterEach(() => vi.useRealTimers());

test("WebSocket handshake timeout picks next endpoint after nonzero backoff and is cleared on open", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // The fixture implements event listeners but its deliberately narrow return type omits them.
  const { Socket, latest } = createControllableSocketClass();
  const client = createClient(
    withEndpoint(...endpoints),
    withWebSocketHandle(Socket),
    withWebSocketReconnect({ attempts: 1, delayMs: 10, connectTimeoutMs: 100 }),
  );
  const pending = defineWebSocket({
    path: "/",
    incoming: struct.unknown(),
  })(client);
  await vi.waitFor(() => expect(latest()?.url).toBe("wss://first.test/"), {
    interval: 1,
  });
  const first = latest();
  await vi.advanceTimersByTimeAsync(100);
  expect(latest()).toBe(first);
  await vi.advanceTimersByTimeAsync(10);
  await vi.waitFor(() => expect(latest()?.url).toBe("wss://second.test/"), {
    interval: 1,
  });
  expect(first?.readyState).toBe(Socket.CLOSING);
  latest()?.triggerOpen();
  const [error, session] = await pending;
  expect(error).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(session?.state).toBe("open");
  expect(vi.getTimerCount()).toBe(0);
  session?.close();
  latest()?.triggerClose({ code: 1000, reason: "", wasClean: true });
  await session?.closed;
});

test("WebSocket handshake timeout exhausted ends as NET_TIMEOUT", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // The fixture implements event listeners but its deliberately narrow return type omits them.
  const { Socket, latest } = createControllableSocketClass();
  const client = createClient(
    withEndpoint(...endpoints),
    withWebSocketHandle(Socket),
    withWebSocketReconnect({ attempts: 0, connectTimeoutMs: 100 }),
  );
  const pending = defineWebSocket({
    path: "/",
    incoming: struct.unknown(),
  })(client);
  await vi.waitFor(() => expect(latest()).toBeDefined());
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(vi.getTimerCount()).toBe(0);
});

test.each([0, -1, Infinity, NaN])(
  "invalid WebSocket connectTimeoutMs %s fails before construction",
  async (connectTimeoutMs) => {
    const client = createClient(
      withEndpoint(...endpoints),
      withWebSocketReconnect({ connectTimeoutMs }),
    );
    expect(
      (
        await defineWebSocket({
          path: "/",
          incoming: struct.unknown(),
        })(client)
      )[0]?.code,
    ).toBe("REQ_OPTIONS_INVALID");
  },
);

test("caller cancellation during timed-out socket teardown remains unattributed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const controller = new AbortController();
  const reports: DoneInfo[] = [];
  const { Socket, latest } = createControllableSocketClass();
  class CancellingSocket extends Socket {
    override close() {
      controller.abort();
      super.close();
    }
  }
  const client = createClient(
    withEndpoint(...endpoints),
    withBalancer({
      pick() {
        return [
          null,
          {
            endpoint: endpoints[0] ?? "",
            done(info) {
              reports.push(info);
            },
          },
        ];
      },
    }),
    withWebSocketHandle(CancellingSocket),
    withWebSocketReconnect({ attempts: 0, connectTimeoutMs: 100 }),
  );
  const pending = defineWebSocket({
    path: "/",
    incoming: struct.unknown(),
  })(client({ signal: controller.signal }));
  await vi.waitFor(() => expect(latest()).toBeDefined());
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_ABORTED");
  expect(reports).toEqual([{ attempted: false }]);
  expect(vi.getTimerCount()).toBe(0);
});
