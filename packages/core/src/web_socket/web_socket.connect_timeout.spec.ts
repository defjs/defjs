import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withBalancer,
  withWebSocketHandle,
  withRetry,
} from "../client/option";
import { createFakeWebSocket, FakeWebSocket } from "../../test/fake_web_socket";
import type { DoneInfo } from "../balancer/balancer";
import { struct } from "../struct";
import { defineWebSocket } from "./web_socket";

const endpoints = ["https://first.test", "https://second.test"];
afterEach(() => vi.useRealTimers());

test("WebSocket handshake timeout picks next endpoint after nonzero backoff and is cleared on open", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const fake = createFakeWebSocket({ handshake: "manual" });
  const client = createClient(
    withEndpoint(...endpoints),
    withWebSocketHandle(fake.Socket),
    withRetry({ maxRetries: 1, delayMs: 10, attemptTimeoutMs: 100 }),
  );
  const pending = defineWebSocket({
    path: "/",
    incoming: struct.unknown(),
  })(client);
  await vi.waitFor(() => expect(fake.last().url).toBe("wss://first.test/"), {
    interval: 1,
  });
  const first = fake.last();
  await vi.advanceTimersByTimeAsync(100);
  expect(fake.last()).toBe(first);
  await vi.advanceTimersByTimeAsync(10);
  await vi.waitFor(() => expect(fake.last().url).toBe("wss://second.test/"), {
    interval: 1,
  });
  expect(first.readyState).toBe(FakeWebSocket.CLOSING);
  fake.last().open();
  const [error, session] = await pending;
  expect(error).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(session?.state).toBe("open");
  expect(vi.getTimerCount()).toBe(0);
  session?.close();
  fake.last().peerClose(1000);
  await session?.closed;
});

test("WebSocket handshake timeout exhausted ends as NET_TIMEOUT", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const fake = createFakeWebSocket({ handshake: "manual" });
  const client = createClient(
    withEndpoint(...endpoints),
    withWebSocketHandle(fake.Socket),
    withRetry({ maxRetries: 0, attemptTimeoutMs: 100 }),
  );
  const pending = defineWebSocket({
    path: "/",
    incoming: struct.unknown(),
  })(client);
  await vi.waitFor(() => expect(fake.sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(vi.getTimerCount()).toBe(0);
});

test("caller cancellation during timed-out socket teardown remains unattributed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const controller = new AbortController();
  const reports: DoneInfo[] = [];
  const fake = createFakeWebSocket({ handshake: "manual" });
  class CancellingSocket extends fake.Socket {
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
    withRetry({ maxRetries: 0, attemptTimeoutMs: 100 }),
  );
  const pending = defineWebSocket({
    path: "/",
    incoming: struct.unknown(),
  })(client({ signal: controller.signal }));
  await vi.waitFor(() => expect(fake.sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_ABORTED");
  expect(reports).toEqual([{ attempted: false }]);
  expect(vi.getTimerCount()).toBe(0);
});
