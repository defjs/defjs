import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withEndpointBalancer,
  withSSEHandle,
  withSSEReconnect,
} from "../client/option";
import { pickFirstBalancer, type EndpointDoneInfo } from "../balancer/balancer";
import { defineEventStream } from "./sse";
import { struct } from "../struct";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";

const endpoints = ["https://first.test", "https://second.test"];
afterEach(() => vi.useRealTimers());

test.each([false, true])(
  "SSE handshake timeout reconnects after nonzero backoff and stops its timer after headers (custom policy: %s)",
  async (customPolicy) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const urls: string[] = [];
    const reports: EndpointDoneInfo[] = [];
    const balancer = pickFirstBalancer();
    const client = createClient(
      withEndpoint(...endpoints),
      withEndpointBalancer({
        pick(info) {
          const [error, result] = balancer.pick(info);
          if (error) return [error, undefined];
          return [
            null,
            {
              endpoint: result.endpoint,
              done(report) {
                reports.push(report);
                result.done?.(report);
              },
            },
          ];
        },
      }),
      withSSEReconnect({
        attempts: 1,
        delayMs: 10,
        connectTimeoutMs: 100,
        shouldReconnect: customPolicy ? async () => true : undefined,
      }),
      withSSEHandle(async (input) => {
        urls.push(new Request(input).url);
        if (urls.length === 1) return new Promise<Response>(() => {});
        return new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    const pending = defineEventStream({
      path: "/",
      events: { message: struct.string() },
    })(client);
    await vi.waitFor(() => expect(urls).toHaveLength(1), { interval: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(urls).toHaveLength(2), { interval: 1 });
    const [error, stream] = await pending;
    expect(error).toBeNull();
    expect(urls).toEqual([`${endpoints[0]}/`, `${endpoints[1]}/`]);
    expect(reports).toEqual([{ attempted: true, code: "NET_UNREACHABLE" }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(urls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    stream?.close();
    await stream?.closed;
  },
);

test("SSE handshake timeout exhausted ends as NET_TIMEOUT", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let calls = 0;
  const client = createClient(
    withEndpoint(...endpoints),
    withSSEReconnect({ attempts: 0, connectTimeoutMs: 100 }),
    withSSEHandle(async () => {
      calls++;
      return new Promise<Response>(() => {});
    }),
  );
  const pending = defineEventStream({
    path: "/",
    events: { message: struct.string() },
  })(client);
  await vi.waitFor(() => expect(calls).toBe(1));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(vi.getTimerCount()).toBe(0);
});

test.each([0, -1, Infinity, NaN])(
  "invalid SSE connectTimeoutMs %s fails before fetch",
  async (connectTimeoutMs) => {
    const client = createClient(
      withEndpoint(...endpoints),
      withSSEReconnect({ connectTimeoutMs }),
    );
    expect(
      (
        await defineEventStream({
          path: "/",
          events: { message: struct.string() },
        })(client)
      )[0]?.code,
    ).toBe("REQ_OPTIONS_INVALID");
  },
);

test("SSE clears handshake timeout before waiting for reconnect backoff", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let calls = 0;
  const client = createClient(
    withEndpoint(...endpoints),
    withSSEReconnect({ attempts: 1, delayMs: 1000, connectTimeoutMs: 100 }),
    withSSEHandle(async () => {
      calls++;
      if (calls === 1) throw new Error("connection refused");
      return new Response("", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }),
  );
  const pending = defineEventStream({
    path: "/",
    events: { message: struct.string() },
  })(client);
  await vi.waitFor(() => expect(calls).toBe(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending)[0]).toBeNull();
  expect(calls).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  { cause: ERR_TIMEOUT, code: "NET_TIMEOUT" },
  { cause: ERR_ABORTED, code: "NET_ABORTED" },
])(
  "caller $code during SSE handshake-timeout backoff ends the call without another pick",
  async ({ cause, code }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const controller = new AbortController();
    const reports: EndpointDoneInfo[] = [];
    let picks = 0;
    let calls = 0;
    let settled = false;
    const balancer = pickFirstBalancer();
    const client = createClient(
      withEndpoint(...endpoints),
      withEndpointBalancer({
        pick(info) {
          picks++;
          const [error, result] = balancer.pick(info);
          if (error) return [error, undefined];
          return [
            null,
            {
              endpoint: result.endpoint,
              done(report) {
                reports.push(report);
                result.done?.(report);
              },
            },
          ];
        },
      }),
      withSSEReconnect({ attempts: 2, delayMs: 1000, connectTimeoutMs: 100 }),
      withSSEHandle(async () => {
        calls++;
        return new Promise<Response>(() => {});
      }),
    );
    const pending = defineEventStream({
      path: "/",
      events: { message: struct.string() },
    })(client({ signal: controller.signal })).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(calls).toBe(1), { interval: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(reports).toEqual([{ attempted: true, code: "NET_UNREACHABLE" }]);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    controller.abort(cause);
    expect((await pending)[0]?.code).toBe(code);
    expect(picks).toBe(1);
    expect(calls).toBe(1);
    expect(reports).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);
