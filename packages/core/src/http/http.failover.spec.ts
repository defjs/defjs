import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withRetry,
  withBalancer,
  withHTTPHandle,
  withInterceptors,
  withXSRF,
  type ClientOption,
} from "../client/option";
import type { DoneInfo, PickInfo } from "../balancer/balancer";
import type { RetryCondition, RetryOptions } from "../client/config";
import { defineRequest } from "./http";
import { struct } from "../struct";
import { ERR_TIMEOUT } from "../error";
import { makeResponse } from "../internal/http_response";

const endpoints = ["https://first.test", "https://second.test"];
const policy = (options: RetryOptions = {}): ClientOption =>
  withRetry({ delayMs: 0, ...options });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(...options: ClientOption[]) {
  const requests: Request[] = [];
  const picks: PickInfo[] = [];
  const reports: DoneInfo[] = [];
  const client = createClient(
    withEndpoint(...endpoints),
    withBalancer({
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
    // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
    withHTTPHandle(async (input) => {
      const request = new Request(input);
      requests.push(request);
      if (request.url.startsWith(endpoints[0] ?? ""))
        throw new TypeError("connection refused");
      return new Response("ok");
    }),
    policy(),
    ...options,
  );
  return { client, requests, picks, reports };
}

test("explicit empty failover enables GET connection failover; POST does not", async () => {
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
    policy({ maxAttempts: 2, methods: ["POST"], on: ["connect-failure"] }),
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
      policy({ maxAttempts: 2, methods: ["GET"], on: ["gateway-error"] }),
      withHTTPHandle(() => {
        calls++;
        return Promise.resolve(
          calls === 1
            ? new Response(
                new ReadableStream({
                  cancel() {
                    cancelled = true;
                  },
                }),
                { status },
              )
            : new Response("ok"),
        );
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
    withHTTPHandle((input) => {
      urls.push(new Request(input).url);
      return Promise.resolve(
        new Response(null, { status: urls.length === 1 ? 503 : 200 }),
      );
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
        maxAttempts: 2,
        methods: ["GET"],
        on: ["attempt-timeout"],
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
  { maxAttempts: -1 },
  { maxAttempts: 1.5 },
  { maxAttempts: Infinity },
  { methods: [""] },
  { attemptTimeoutMs: 0 },
  { attemptTimeoutMs: -1 },
  { attemptTimeoutMs: Infinity },
])("invalid failover option %j fails at execution", async (options) => {
  const { client } = fixture(policy(options));
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
  ).toBe("REQ_OPTIONS_INVALID");
});

test.each([{ on: ["bad"] }, { methods: [1] }])(
  "invalid typed failover option %j fails at execution",
  async (options) => {
    const { client } = fixture(
      // @ts-expect-error invalid failover fields are rejected at execution
      policy(options),
    );
    expect(
      (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
    ).toBe("REQ_OPTIONS_INVALID");
  },
);

test("attempt timeout covers headers followed by a stalled declared body", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let calls = 0;
  const { client, reports } = fixture(
    policy({
      maxAttempts: 2,
      on: ["attempt-timeout"],
      attemptTimeoutMs: 100,
    }),
    withHTTPHandle(() => {
      calls++;
      return Promise.resolve(
        new Response(calls === 1 ? new ReadableStream() : "ok"),
      );
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
  const conditions: RetryCondition[] = ["connect-failure"];
  const methods = ["get"];
  const { client } = fixture(
    policy({
      get on() {
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
  const disabled = fixture(policy({ methods: [] }));
  expect(
    (await defineRequest({ method: "GET", path: "/" })(disabled.client))[0]
      ?.code,
  ).toBe("NET_UNREACHABLE");
  expect(disabled.requests).toHaveLength(1);
  const reset = fixture(policy({ maxAttempts: 1, methods: [] }), policy());
  expect(
    (await defineRequest({ method: "GET", path: "/" })(reset.client))[0],
  ).toBeNull();
});

test("custom option with omitted failover fields retains safe connection-failure defaults", async () => {
  const { client } = fixture((config) => {
    config.http.retry = { delayMs: 0 };
  });
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
});

test("gateway failover accepts a 503 HTML response rejected by its JSON error struct", async () => {
  let calls = 0;
  let released = false;
  const { client } = fixture(
    policy({ on: ["gateway-error"] }),
    withHTTPHandle(() => {
      calls++;
      if (calls === 1)
        return Promise.resolve(
          new Response(
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
          ),
        );
      return Promise.resolve(new Response("ok"));
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
      policy({ on: ["gateway-error"] }),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 503 })),
      ),
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
    // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
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

test("default clients do not fail over GET or create or deposit a retry budget", async () => {
  const budget = vi.spyOn(
    await import("../balancer/retry_budget"),
    "retryBudgetFor",
  );
  const requests: string[] = [];
  const client = createClient(
    withEndpoint(...endpoints),
    withHTTPHandle((input) => {
      requests.push(new Request(input).url);
      return Promise.reject(new TypeError("connection refused"));
    }),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
  ).toBe("NET_UNREACHABLE");
  expect(requests).toEqual([`${endpoints[0]}/`]);
  expect(budget).not.toHaveBeenCalled();
});

test.each([1, 2, 3, Number.MAX_SAFE_INTEGER])(
  "maxAttempts %i counts the original and never repeats endpoints",
  async (maxAttempts) => {
    const seen: string[] = [];
    const candidates = [...endpoints, "https://third.test"];
    const client = createClient(
      withEndpoint(...candidates),
      policy({ maxAttempts, budget: false }),
      withHTTPHandle((input) => {
        seen.push(new Request(input).url);
        return Promise.reject(new TypeError("connection refused"));
      }),
    );
    expect(
      (await defineRequest({ method: "GET", path: "/" })(client))[0]?.code,
    ).toBe("NET_UNREACHABLE");
    expect(seen).toEqual(
      candidates
        .slice(0, Math.min(maxAttempts, 3))
        .map((endpoint) => `${endpoint}/`),
    );
  },
);

test.each([0, -1, 1.5, NaN, "2", Number.MAX_SAFE_INTEGER + 1, null, true])(
  "invalid maxAttempts %j fails before transport",
  async (maxAttempts) => {
    const handle = vi.fn(() => Promise.resolve(new Response("ok")));
    const client = createClient(
      withEndpoint(...endpoints),
      // @ts-expect-error invalid runtime attempt limits must be validated
      withRetry({ maxAttempts }),
      withHTTPHandle(handle),
    );
    const [fault] = await defineRequest({ method: "GET", path: "/" })(client);
    expect(fault?.code).toBe("REQ_OPTIONS_INVALID");
    expect(fault?.cause).toEqual(new RangeError("Invalid retry options"));
    expect(handle).not.toHaveBeenCalled();
  },
);

test.each([[], "enabled", null, true, 1, () => ({})])(
  "invalid custom failover block %j fails before transport",
  async (failover) => {
    const handle = vi.fn(() => Promise.resolve(new Response("ok")));
    const client = createClient(
      withEndpoint(...endpoints),
      // @ts-expect-error invalid runtime retry containers must be validated
      withRetry(failover),
      withHTTPHandle(handle),
    );
    const [fault] = await defineRequest({ method: "GET", path: "/" })(client);
    expect(fault?.code).toBe("REQ_OPTIONS_INVALID");
    expect(fault?.cause).toEqual(new RangeError("Invalid retry options"));
    expect(handle).not.toHaveBeenCalled();
  },
);

test("custom option retry configuration is read anew for every HTTP call", async () => {
  let calls = 0;
  let setRetry: (() => void) | undefined;
  const client = createClient(
    withEndpoint(...endpoints),
    (config) => {
      setRetry = () => {
        config.http.retry = { delayMs: 0 };
      };
    },
    withHTTPHandle(() => {
      calls++;
      return calls === 3
        ? Promise.resolve(new Response("ok"))
        : Promise.reject(new TypeError("refused"));
    }),
  );
  const op = defineRequest({ method: "GET", path: "/" });
  expect((await op(client))[0]?.code).toBe("NET_UNREACHABLE");
  expect(calls).toBe(1);
  setRetry?.();
  expect((await op(client))[0]).toBeNull();
  expect(calls).toBe(3);
});

test("pre-fetch XSRF failure is not an endpoint attempt and never retries", async () => {
  const error = new TypeError("token unavailable");
  const start = vi.fn();
  const { client, requests, reports } = fixture(
    policy({ methods: ["POST"] }),
    withBalancer({
      pick: (info) => [
        null,
        {
          endpoint: info.endpoints[0] ?? "",
          start,
          done: (report) => reports.push(report),
        },
      ],
    }),
    withXSRF({
      tokenProvider() {
        throw error;
      },
    }),
  );
  const [fault] = await defineRequest({ method: "POST", path: "/" })(client);
  expect(fault?.code).toBe("NET_UNREACHABLE");
  expect(fault?.cause).toBe(error);
  expect(fault?.message).toBe("token unavailable");
  expect(reports).toEqual([{ attempted: false }]);
  expect(start).not.toHaveBeenCalled();
  expect(requests).toHaveLength(0);
});

test.each([
  ["GET", ["POST"], ["GET"], 1, "NET_UNREACHABLE"],
  ["POST", ["GET"], ["get"], 2, null],
  ["GET", ["POST", "GET"], ["GET"], 2, "NET_UNREACHABLE"],
  ["GET", ["GET", "POST"], ["GET"], 2, "NET_UNREACHABLE"],
  ["POST", ["GET", "GET"], ["gEt"], 4, null],
] as const)(
  "retry checks all transported methods: definition %s, sends %j, allows %j",
  async (method, sent, methods, count, code) => {
    const { client, requests } = fixture(
      policy({ methods }),
      withInterceptors({
        kind: "http",
        async fn(request, next) {
          for (const rewritten of sent.slice(0, -1)) {
            await next({ ...request, method: rewritten }).catch(
              () => undefined,
            );
          }
          return next({ ...request, method: sent.at(-1) ?? method });
        },
      }),
    );
    const [fault] = await defineRequest({ method, path: "/" })(client);
    expect(fault?.code ?? null).toBe(code);
    expect(requests.map((request) => request.method)).toEqual(
      Array.from({ length: count }, (_, index) => sent[index % sent.length]),
    );
  },
);

test("an undefined interceptor method returns a fault tuple without retrying", async () => {
  const { client, requests } = fixture(
    withInterceptors({
      kind: "http",
      fn(request, next) {
        // @ts-expect-error JavaScript interceptors may omit the required method
        return next({ ...request, method: undefined });
      },
    }),
  );
  const result = await defineRequest({ method: "GET", path: "/" })(client);
  expect(result[0]?.code).toBe("NET_UNREACHABLE");
  expect(requests.map((request) => request.method)).toEqual(["GET"]);
});

test("a lowercase transported method remains eligible for retry", async () => {
  const { client, requests } = fixture(
    withInterceptors({
      kind: "http",
      fn(request, next) {
        return next({ ...request, method: "get" });
      },
    }),
  );
  const [fault] = await defineRequest({ method: "POST", path: "/" })(client);
  expect(fault).toBeNull();
  expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
});
