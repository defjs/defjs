import { afterEach, expect, inject, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  defineEventStream,
  defineWebSocket,
  withEndpoint,
  withEndpointBalancer,
  withInterceptors,
  withHTTPHandle,
  withEndpointFailover,
  withSSEHandle,
  withWebSocketHandle,
  struct,
} from "../src";
import type { EndpointBalancer } from "../src";
import { makeResponse } from "../src/internal/http_response";
import { p2cBalancer } from "../src/balancer/p2c";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function recording(events: string[]): EndpointBalancer {
  return {
    pick({ endpoints }) {
      const endpoint = endpoints[0] ?? "";
      return [
        null,
        {
          endpoint,
          start: () => {
            events.push(`start:${endpoint}`);
          },
          done: () => {
            events.push(`done:${endpoint}`);
          },
        },
      ];
    },
  };
}
test("HTTP failover starts and finishes each physical attempt separately", async () => {
  const host = inject("testServerHost");
  const events: string[] = [];
  const client = createClient(
    withEndpoint("http://127.0.0.1:1", host),
    withEndpointBalancer(recording(events)),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/json" })(client))[0],
  ).toBeNull();
  expect(events).toEqual([
    "start:http://127.0.0.1:1",
    "done:http://127.0.0.1:1",
    `start:${host}`,
    `done:${host}`,
  ]);
});
test.each(["throw", "reject"])(
  "throwing or rejected HTTP start (%s) cannot replace the result",
  async (mode) => {
    let calls = 0;
    const b: EndpointBalancer = {
      pick: () => [
        null,
        {
          endpoint: inject("testServerHost"),
          // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the mock deliberately returns a rejected promise
          start() {
            calls++;
            if (mode === "throw") throw new Error("start");
            return Promise.reject(new Error("start"));
          },
        },
      ],
    };
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withEndpointBalancer(b),
    );
    expect(
      (await defineRequest({ method: "GET", path: "/json" })(client))[0],
    ).toBeNull();
    expect(calls).toBe(1);
  },
);
test("SSE starts immediately before Fetch and closes its one attributed attempt", async () => {
  const host = inject("testServerHost");
  const events: string[] = [];
  const client = createClient(
    withEndpoint(host),
    withEndpointBalancer(recording(events)),
    withSSEHandle(async (...args) => {
      expect(events).toEqual([`start:${host}`]);
      return fetch(...args);
    }),
  );
  const [err, stream] = await defineEventStream({
    path: "/sse/infinite",
    events: { tick: struct.string() },
  })(client);
  expect(err).toBeNull();
  if (!stream) throw new Error("missing stream");
  try {
    await stream[Symbol.asyncIterator]().next();
  } finally {
    await stream[Symbol.asyncDispose]();
  }
  expect(events).toEqual([`start:${host}`, `done:${host}`]);
});
test("WebSocket starts before constructing the native socket", async () => {
  const host = inject("testServerHost");
  const events: string[] = [];
  class ObservedSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      expect(events).toEqual([`start:${host}`]);
      super(url, protocols);
    }
  }
  const client = createClient(
    withEndpoint(host),
    withEndpointBalancer(recording(events)),
    withWebSocketHandle(ObservedSocket),
  );
  const [err, session] = await defineWebSocket({
    path: "/ws/basic",
    maxIncomingQueueSize: 4,
    incoming: struct.unknown(),
  })(client);
  expect(err).toBeNull();
  if (!session) throw new Error("missing session");
  await session[Symbol.asyncDispose]();
  expect(events).toEqual([`start:${host}`, `done:${host}`]);
});
test.each(["builder", "short-circuit", "abort", "replacement"])(
  "HTTP %s never starts the selected endpoint but completes once",
  async (mode) => {
    const host = inject("testServerHost");
    const events: string[] = [];
    const controller = new AbortController();
    const client = createClient(
      withEndpoint(host),
      withEndpointBalancer(recording(events)),
      withInterceptors({
        kind: "http",
        async fn(req, next) {
          if (mode === "short-circuit") return makeResponse({ status: 204 });
          if (mode === "abort") controller.abort();
          return next(
            mode === "replacement" ? { ...req, baseEndpoint: host + "/" } : req,
          );
        },
      }),
    );
    const op = defineRequest({
      method: "GET",
      path: "/json",
      builder: () => {
        if (mode === "builder") throw new Error("build");
        return {};
      },
    });
    await op(client({ signal: controller.signal }));
    // Also exercise a reached transport: this test must detect a missing start hook.
    expect(events).toEqual([`done:${host}`]);
    events.length = 0;
    const live = createClient(
      withEndpoint(host),
      withEndpointBalancer(recording(events)),
    );
    await defineRequest({ method: "GET", path: "/json" })(live);
    expect(events).toEqual([`start:${host}`, `done:${host}`]);
  },
);
test("p2c excludes both 80ms interceptor phases while a slow physical request remains pending", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
  const b = p2cBalancer({ load: "pending", outlierDetection: false });
  const [, slow] = b.pick({
    endpoints: ["https://slow.test"],
    transport: "http",
  });
  slow?.start?.();
  const selections: string[] = [];
  const client = createClient(
    withEndpoint("https://fast.test", "https://slow.test"),
    withEndpointFailover({ attempts: 0 }),
    withEndpointBalancer(b),
    withHTTPHandle(() => {
      selections.push(
        b.pick({
          endpoints: ["https://fast.test", "https://slow.test"],
          transport: "http",
        })[1]?.endpoint ?? "",
      );
      return Promise.resolve(new Response(null));
    }),
    withInterceptors({
      kind: "http",
      async fn(req, next) {
        vi.setSystemTime(Date.now() + 80);
        selections.push(
          b.pick({
            endpoints: ["https://fast.test", "https://slow.test"],
            transport: "http",
          })[1]?.endpoint ?? "",
        );
        const response = await next(req);
        vi.setSystemTime(Date.now() + 80);
        selections.push(
          b.pick({
            endpoints: ["https://fast.test", "https://slow.test"],
            transport: "http",
          })[1]?.endpoint ?? "",
        );
        return response;
      },
    }),
  );
  for (let i = 0; i < 8; i++)
    expect(
      (await defineRequest({ method: "GET", path: "/" })(client))[0],
    ).toBeNull();
  expect(selections).toEqual(Array(24).fill("https://fast.test"));
  slow?.done?.({ attempted: false });
});
