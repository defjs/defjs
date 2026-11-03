import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withEndpointBalancer,
  withEndpointFailover,
  type EndpointFailoverCondition,
  type EndpointFailoverOptions,
  withHTTPHandle,
  withInterceptors,
  type ClientOption,
} from "../client/option";
import type { EndpointDoneInfo, EndpointPickInfo } from "../balancer/balancer";
import { defineRequest } from "./http";
import { struct } from "../struct";
import { ERR_TIMEOUT } from "../error";
import { makeResponse } from "../internal/http_response";

const endpoints = ["https://first.test", "https://second.test"];
// Some cases deliberately supply invalid runtime values at this typed boundary.
const policy = (options: object): ClientOption =>
  withEndpointFailover(options as EndpointFailoverOptions);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(...options: ClientOption[]) {
  const requests: Request[] = [];
  const picks: EndpointPickInfo[] = [];
  const reports: EndpointDoneInfo[] = [];
  const client = createClient(
    withEndpoint(...endpoints),
    withEndpointBalancer({
      pick(info) {
        picks.push(info);
        return [
          null,
          {
            endpoint: info.endpoints[0] ?? "",
            done: (report) => reports.push(report),
          },
        ];
      },
    }),
    withHTTPHandle(async (input) => {
      const request = new Request(input);
      requests.push(request);
      if (request.url.startsWith(endpoints[0] ?? ""))
        throw new TypeError("connection refused");
      return new Response("ok");
    }),
    ...options,
  );
  return { client, requests, picks, reports };
}

test("default GET fails over immediately; POST does not", async () => {
  const { client, requests } = fixture();
  const get = await defineRequest({
    method: "GET",
    path: "/",
    output: struct.string(),
  })(client);
  expect(get[0]).toBeNull();
  expect(get[1]).toBe("ok");
  const post = await defineRequest({ method: "POST", path: "/" })(client);
  expect(post[0]?.code).toBe("NET_UNREACHABLE");
  expect(requests).toHaveLength(3);
});

test("ReadableStream requests never fail over even for an opted-in POST", async () => {
  const { client, requests } = fixture(
    policy({ attempts: 1, methods: ["POST"], retryOn: ["connect-failure"] }),
  );
  const [fault] = await defineRequest({
    method: "POST",
    path: "/",
    builder: () => ({
      body: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
    }),
  })(client);
  expect(fault?.code).toBe("NET_UNREACHABLE");
  expect(requests).toHaveLength(1);
});

test("failover rebuilds and reruns endpoint-specific authentication", async () => {
  const seen: string[] = [];
  let builds = 0;
  const { client, requests } = fixture(
    withInterceptors({
      kind: "http",
      async fn(request, next) {
        seen.push(request.baseEndpoint ?? "");
        request.headers = new Headers(request.headers);
        request.headers.set("Authorization", `Bearer ${request.baseEndpoint}`);
        return next(request);
      },
    }),
  );
  const result = await defineRequest({
    method: "GET",
    path: "/",
    builder: () => {
      builds++;
      return {};
    },
  })(client);
  expect(result[0]).toBeNull();
  expect(builds).toBe(2);
  expect(seen).toEqual(endpoints);
  expect(
    requests.map((request) => request.headers.get("Authorization")),
  ).toEqual(endpoints.map((endpoint) => `Bearer ${endpoint}`));
});

test("each attempt picks and reports exactly once with tried endpoints excluded", async () => {
  const { client, picks, reports } = fixture();
  await defineRequest({ method: "GET", path: "/" })(client);
  expect(picks.map((pick) => pick.endpoints)).toEqual([
    endpoints,
    [endpoints[1]],
  ]);
  expect(reports).toHaveLength(2);
  expect(reports[0]).toEqual({ attempted: true, code: "NET_UNREACHABLE" });
  expect(reports[1]).toMatchObject({ attempted: true, status: 200 });
});

test("gateway-error retries a released 503 response but 500 does not retry", async () => {
  for (const status of [503, 500]) {
    let calls = 0;
    let cancelled = false;
    const client = createClient(
      withEndpoint(...endpoints),
      policy({ attempts: 1, methods: ["GET"], retryOn: ["gateway-error"] }),
      withHTTPHandle(async () => {
        calls++;
        return calls === 1
          ? new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                },
              }),
              { status },
            )
          : new Response("ok");
      }),
    );
    const result = await defineRequest({ method: "GET", path: "/" })(client);
    expect(result[0]?.code ?? null).toBe(status === 503 ? null : "HTTP_STATUS");
    expect(calls).toBe(status === 503 ? 2 : 1);
    expect(cancelled).toBe(true);
  }
});

test("without gateway-error the next call, not this call, advances after 503", async () => {
  const urls: string[] = [];
  const client = createClient(
    withEndpoint(...endpoints),
    withHTTPHandle(async (input) => {
      urls.push(new Request(input).url);
      return new Response(null, { status: urls.length === 1 ? 503 : 200 });
    }),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
  ).toBe("HTTP_STATUS");
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
  expect(urls).toEqual([`${endpoints[0]}/`, `${endpoints[1]}/`]);
});

test("offline failures do not fail over", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const { client, requests } = fixture();
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
  ).toBe("NET_UNREACHABLE");
  expect(requests).toHaveLength(1);
});

test("attempt timeout fails over while caller deadline covers the whole call", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  for (const deadline of [false, true]) {
    let calls = 0;
    const controller = new AbortController();
    const { client, reports } = fixture(
      policy({
        attempts: 1,
        methods: ["GET"],
        retryOn: ["attempt-timeout"],
        attemptTimeoutMs: 100,
      }),
      withHTTPHandle(async () => {
        calls++;
        if (calls === 1 || deadline) return new Promise<Response>(() => {});
        return new Response("ok");
      }),
    );
    const pending = defineRequest({ method: "GET", path: "/" })(
      client({ signal: controller.signal }),
    );
    await vi.waitFor(() => expect(calls).toBe(1));
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(calls).toBe(2), { interval: 1 });
    if (deadline) controller.abort(ERR_TIMEOUT);
    expect((await pending)[0]?.code ?? null).toBe(
      deadline ? "NET_TIMEOUT" : null,
    );
    expect(calls).toBe(2);
    expect(reports[0]).toEqual({ attempted: true, code: "NET_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  }
});

test.each([
  { attempts: -1 },
  { attempts: 0.5 },
  { attempts: Infinity },
  { retryOn: ["bad"] },
  { methods: [""] },
  { methods: [1] },
  { attemptTimeoutMs: 0 },
  { attemptTimeoutMs: -1 },
  { attemptTimeoutMs: Infinity },
])("invalid failover option %j fails at execution", async (options) => {
  const { client } = fixture(policy(options));
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
  ).toBe("REQ_OPTIONS_INVALID");
});

test("attempt timeout covers headers followed by a stalled declared body", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let calls = 0;
  const { client, reports } = fixture(
    policy({
      attempts: 1,
      retryOn: ["attempt-timeout"],
      attemptTimeoutMs: 100,
    }),
    withHTTPHandle(async () => {
      calls++;
      return new Response(calls === 1 ? new ReadableStream() : "ok");
    }),
  );
  const pending = defineRequest({
    method: "GET",
    path: "/",
    output: struct.string(),
  })(client);
  await vi.waitFor(() => expect(calls).toBe(1));
  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() => expect(calls).toBe(2));
  expect((await pending)[1]).toBe("ok");
  expect(reports[0]).toEqual({ attempted: true, code: "NET_TIMEOUT" });
  expect(vi.getTimerCount()).toBe(0);
});

test("an interceptor-recovered transport failure does not discard a successful tuple", async () => {
  const { client, requests } = fixture(
    withInterceptors({
      kind: "http",
      async fn(request, next) {
        try {
          return await next(request);
        } catch {
          return makeResponse({ status: 200 });
        }
      },
    }),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
  expect(requests).toHaveLength(1);
});

test("failover option snapshots arrays and reads each owned field once", async () => {
  let reads = 0;
  const conditions: EndpointFailoverCondition[] = ["connect-failure"];
  const methods = ["get"];
  const { client } = fixture(
    withEndpointFailover({
      get retryOn() {
        reads++;
        return conditions;
      },
      methods,
    }),
  );
  conditions.length = 0;
  methods.length = 0;
  expect(reads).toBe(1);
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
});

test("later failover policy replaces earlier settings and empty methods disables it", async () => {
  const disabled = fixture(withEndpointFailover({ methods: [] }));
  expect(
    (await defineRequest({ method: "GET", path: "/" })(disabled.client))[0]
      ?.code,
  ).toBe("NET_UNREACHABLE");
  expect(disabled.requests).toHaveLength(1);
  const reset = fixture(
    withEndpointFailover({ attempts: 0, methods: [] }),
    withEndpointFailover(),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(reset.client))[0],
  ).toBeNull();
});

test("custom option with omitted failover fields retains safe connection-failure defaults", async () => {
  const { client } = fixture((config) => {
    config.endpointFailover = {};
  });
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
});

test("gateway failover accepts a 503 HTML response rejected by its JSON error struct", async () => {
  let calls = 0;
  let released = false;
  const { client } = fixture(
    withEndpointFailover({ retryOn: ["gateway-error"] }),
    withHTTPHandle(async () => {
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode("<html>unavailable</html>"),
              );
            },
            cancel() {
              released = true;
            },
          }),
          { status: 503, headers: { "Content-Type": "text/html" } },
        );
      return new Response("ok");
    }),
  );
  const [error, body] = await defineRequest({
    method: "GET",
    path: "/",
    output: struct.string(),
    error: struct.object({ message: struct.string() }),
  })(client);
  expect(error).toBeNull();
  expect(body).toBe("ok");
  expect(calls).toBe(2);
  expect(released).toBe(true);
});

test.each(["recover", "throw"])(
  "gateway failover preserves an interceptor %s result",
  async (mode) => {
    const { client, picks } = fixture(
      withEndpointFailover({ retryOn: ["gateway-error"] }),
      withHTTPHandle(async () => new Response(null, { status: 503 })),
      withInterceptors({
        kind: "http",
        async fn(request, next) {
          await next(request);
          if (mode === "throw") throw new Error("extension failed");
          return makeResponse({ status: 200 });
        },
      }),
    );
    const [error] = await defineRequest({ method: "GET", path: "/" })(client);
    expect(error?.code ?? null).toBe(
      mode === "throw" ? "EXT_INTERCEPTOR_FAILED" : null,
    );
    expect(picks).toHaveLength(1);
  },
);

test("non-stream failover does not require a global ReadableStream constructor", async () => {
  const response = new Response(null, { status: 204 });
  vi.stubGlobal("ReadableStream", undefined);
  const { client } = fixture(
    withHTTPHandle(async (input) => {
      if (new Request(input).url.startsWith(endpoints[0] ?? ""))
        throw new Error("connection refused");
      return response;
    }),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
});
