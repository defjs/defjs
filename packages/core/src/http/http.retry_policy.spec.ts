import { afterEach, expect, test, vi } from "vitest";
import { pickFirstBalancer, roundRobinBalancer } from "../balancer";
import type { RetryContext, RetryOptions } from "../client/config";
import { createClient } from "../client/client";
import {
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
} from "../client/option";
import { createHttpInterceptor } from "../interceptor";
import { ERR_TIMEOUT } from "../error";
import { struct } from "../struct";
import { defineRequest } from "./http";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const endpoints = ["https://a.test", "https://b.test"];
const get = defineRequest({ method: "GET", path: "/" });

function respond(...statuses: (number | "refused")[]) {
  let calls = 0;
  return vi.fn(() => {
    const status = statuses[Math.min(calls++, statuses.length - 1)];
    return status === "refused"
      ? Promise.reject(new TypeError("refused"))
      : Promise.resolve(new Response(null, { status }));
  });
}

function setup(
  handle: ReturnType<typeof respond>,
  options: RetryOptions = {},
  ...more: Parameters<typeof createClient>
) {
  return createClient(
    withEndpoint(...endpoints),
    withRetry({ delayMs: 0, ...options }),
    withHTTPHandle(handle),
    ...more,
  );
}

test.each([429, 502, 503, 504])(
  "a %i response is retried by default",
  async (status) => {
    const handle = respond(status, 200);
    expect((await get(setup(handle)))[0]).toBeNull();
    expect(handle).toHaveBeenCalledTimes(2);
  },
);

test.each([400, 404, 500])(
  "a %i response is not retried by default, but the policy function is asked",
  async (status) => {
    const contexts: RetryContext[] = [];
    const handle = respond(status, 200);
    const client = setup(handle, {
      shouldRetry(context) {
        contexts.push(context);
        return context.retryable;
      },
    });
    expect((await get(client))[0]?.code).toBe("HTTP_STATUS");
    expect(handle).toHaveBeenCalledTimes(1);
    expect(contexts).toMatchObject([
      { transport: "http", attempt: 1, retryable: false, status },
    ]);
  },
);

test("the policy function can retry a status the default does not", async () => {
  const handle = respond(500, 200);
  const client = setup(handle, {
    shouldRetry: (context) =>
      context.transport === "http" && context.status === 500,
  });
  expect((await get(client))[0]).toBeNull();
  expect(handle).toHaveBeenCalledTimes(2);
});

test("the context describes the failed attempt and its retry number", async () => {
  const contexts: RetryContext[] = [];
  const handle = respond("refused", 503, 200);
  const client = setup(handle, {
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  expect((await get(client))[0]).toBeNull();
  expect(contexts).toHaveLength(2);
  const [first, second] = contexts;
  expect(first).toMatchObject({
    transport: "http",
    attempt: 1,
    retryable: true,
    method: "GET",
    endpoint: endpoints[0],
    status: undefined,
  });
  expect(first?.cause).toMatchObject({ code: "NET_UNREACHABLE" });
  expect(second).toMatchObject({
    transport: "http",
    attempt: 2,
    retryable: true,
    method: "GET",
    status: 503,
  });
  expect(second?.cause).toMatchObject({ code: "HTTP_STATUS" });
});

test("the policy function replaces the default verdict in both directions", async () => {
  const post = defineRequest({ method: "POST", path: "/" });
  const retried = respond("refused", 200);
  expect(
    (await post(setup(retried, { shouldRetry: () => true })))[0],
  ).toBeNull();
  expect(retried).toHaveBeenCalledTimes(2);
  const stopped = respond("refused", 200);
  expect(
    (await get(setup(stopped, { shouldRetry: () => false })))[0]?.code,
  ).toBe("NET_UNREACHABLE");
  expect(stopped).toHaveBeenCalledTimes(1);
});

test.each([
  ["PUT", true],
  ["DELETE", true],
  ["HEAD", true],
  ["OPTIONS", true],
  ["POST", false],
  ["PATCH", false],
] as const)("the default methods decide %s: %s", async (method, retried) => {
  const handle = respond("refused", 200);
  const contexts: RetryContext[] = [];
  const client = setup(handle, {
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  await defineRequest({ method, path: "/" })(client);
  expect(handle).toHaveBeenCalledTimes(retried ? 2 : 1);
  expect(contexts[0]).toMatchObject({ method, retryable: retried });
});

test("the policy function is not asked once maxRetries retries are made", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const handle = respond("refused");
  const client = setup(handle, { maxRetries: 2, shouldRetry });
  expect((await get(client))[0]?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(3);
  expect(shouldRetry.mock.calls.map(([context]) => context.attempt)).toEqual([
    1, 2,
  ]);
});

test("the policy function is not asked after a caller abort", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const controller = new AbortController();
  const handle = respond("refused", 200);
  const client = setup(
    handle,
    { shouldRetry },
    withInterceptors(
      createHttpInterceptor((request, next) => {
        controller.abort();
        return next(request);
      }),
    ),
  );
  const [fault] = await get(client({ signal: controller.signal }));
  expect(fault?.code).toBe("NET_ABORTED");
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("the policy function is not asked after a failure before the request is sent", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const handle = respond(200);
  const client = setup(handle, { shouldRetry }, (config) => {
    config.finalizeHeaders = () => {
      throw new Error("no token");
    };
  });
  expect((await get(client))[0]?.code).toBe("EXT_HOOK_FAILED");
  expect(handle).not.toHaveBeenCalled();
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("a ReadableStream request body is never retried and the policy function is not asked", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const handle = respond("refused", 200);
  const client = setup(handle, { shouldRetry, methods: ["POST"] });
  const [fault] = await defineRequest({
    method: "POST",
    path: "/",
    builder: () => ({
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
  })(client);
  expect(fault).not.toBeNull();
  expect(handle.mock.calls.length).toBeLessThanOrEqual(1);
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("an asynchronous policy function is awaited", async () => {
  const handle = respond("refused", 200);
  const client = setup(handle, {
    shouldRetry: (context) => Promise.resolve(context.retryable),
  });
  expect((await get(client))[0]).toBeNull();
  expect(handle).toHaveBeenCalledTimes(2);
});

test("the caller signal cancels a pending policy function", async () => {
  const controller = new AbortController();
  const handle = respond("refused", 200);
  const client = setup(handle, {
    shouldRetry: () => new Promise<boolean>(() => {}),
  });
  const pending = get(client({ signal: controller.signal }));
  await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
  controller.abort();
  expect((await pending)[0]?.code).toBe("NET_ABORTED");
  expect(handle).toHaveBeenCalledTimes(1);
});

test.each([
  ["throws", () => Promise.reject(new Error("policy failed"))],
  [
    "rejects",
    () => {
      throw new Error("policy failed");
    },
  ],
])(
  "a policy function that %s ends the call with that error as the cause",
  async (_mode, shouldRetry) => {
    const handle = respond("refused", 200);
    const [fault] = await get(setup(handle, { shouldRetry }));
    expect(fault?.code).toBe("EXT_HOOK_FAILED");
    expect(fault?.cause).toEqual(new Error("policy failed"));
    expect(handle).toHaveBeenCalledTimes(1);
  },
);

test("a timeout is retried by default and ends with NET_TIMEOUT when retries run out", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const contexts: RetryContext[] = [];
  const handle = vi.fn(() => new Promise<Response>(() => {}));
  const client = setup(handle, {
    attemptTimeoutMs: 100,
    maxRetries: 1,
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  const pending = get(client);
  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(contexts).toMatchObject([
    { attempt: 1, retryable: true, status: undefined },
  ]);
  expect(contexts[0]?.cause).toMatchObject({ code: "NET_TIMEOUT" });
});

test("maxRetries 0 with attemptTimeoutMs only limits each attempt", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const handle = vi.fn(() => new Promise<Response>(() => {}));
  const pending = get(setup(handle, { attemptTimeoutMs: 100, maxRetries: 0 }));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(handle).toHaveBeenCalledTimes(1);
});

test("a caller deadline is not an attempt timeout and never retries", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const controller = new AbortController();
  const handle = vi.fn(() => new Promise<Response>(() => {}));
  const pending = get(
    setup(handle, { shouldRetry })({ signal: controller.signal }),
  );
  await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
  controller.abort(ERR_TIMEOUT);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("request options replace the client policy and enable retries without one", async () => {
  const handle = respond("refused", "refused", 200);
  const plain = createClient(
    withEndpoint(...endpoints),
    withHTTPHandle(handle),
  );
  expect((await get(plain))[0]?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(1);
  expect(
    (await get(plain({ retry: { delayMs: 0, maxRetries: 2 } })))[0],
  ).toBeNull();
  expect(handle).toHaveBeenCalledTimes(3);
  const stopped = respond("refused", 200);
  const client = setup(stopped);
  expect((await get(client({ retry: { maxRetries: 0 } })))[0]?.code).toBe(
    "NET_UNREACHABLE",
  );
  expect(stopped).toHaveBeenCalledTimes(1);
});

test("a request retry replaces the client policy as a whole, shouldRetry included", async () => {
  const handle = respond("refused", 200);
  const shouldRetry = vi.fn((_context: RetryContext) => false);
  const client = setup(handle, { shouldRetry, maxRetries: 5 });
  expect(
    (await get(client({ retry: { delayMs: 0, maxRetries: 1 } })))[0],
  ).toBeNull();
  expect(handle).toHaveBeenCalledTimes(2);
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("request options keep the budget of the client", async () => {
  const handle = respond("refused");
  const client = setup(handle, {
    budget: { percentCanRetry: 0, minRetriesPerSecond: 0 },
  });
  expect(
    (await get(client({ retry: { delayMs: 0, maxRetries: 3 } })))[0]?.code,
  ).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(1);
});

test("statusCodes configures default retryable statuses and POST 429 stays opt-in", async () => {
  const optOut = respond(429, 200);
  const [optOutFault] = await get(
    setup(optOut, { statusCodes: [502, 503, 504] }),
  );
  expect(optOutFault?.code).toBe("HTTP_STATUS");
  expect(optOut).toHaveBeenCalledTimes(1);

  const optIn = respond(408, 200);
  const [optInFault] = await get(setup(optIn, { statusCodes: [408] }));
  expect(optInFault).toBeNull();
  expect(optIn).toHaveBeenCalledTimes(2);

  const post = defineRequest({ method: "POST", path: "/" });
  const postBlocked = respond(429, 200);
  expect((await post(setup(postBlocked)))[0]?.code).toBe("HTTP_STATUS");
  expect(postBlocked).toHaveBeenCalledTimes(1);

  const postAllowed = respond(429, 200);
  expect((await post(setup(postAllowed, { methods: ["POST"] })))[0]).toBeNull();
  expect(postAllowed).toHaveBeenCalledTimes(2);
});

test.each([429, 503])(
  "honors RFC 9110 Retry-After delay-seconds on %i with positive-only jitter and exposes context headers",
  async (status) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(1);
    const contexts: RetryContext[] = [];
    const first = Promise.withResolvers<void>();
    let calls = 0;
    const handle = vi.fn(() => {
      first.resolve();
      return Promise.resolve(
        calls++ === 0
          ? new Response(null, {
              status,
              headers: { "retry-after": "2", "x-rate-limit-scope": "burst" },
            })
          : new Response(null, { status: 200 }),
      );
    });
    const client = createClient(
      withEndpoint(...endpoints),
      withRetry({
        delayMs: 100,
        jitter: 0.2,
        shouldRetry(context) {
          contexts.push(context);
          return context.retryable;
        },
      }),
      withHTTPHandle(handle),
    );
    const pending = get(client);
    await first.promise;
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2399);
    expect(handle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)[0]).toBeNull();
    expect(handle).toHaveBeenCalledTimes(2);
    expect(contexts[0]?.transport).toBe("http");
    if (contexts[0]?.transport === "http") {
      expect(contexts[0].retryAfterMs).toBe(2000);
      expect(contexts[0].headers?.get("x-rate-limit-scope")).toBe("burst");
    }
  },
);

test("honors Retry-After HTTP-date, ignores it when retryAfter is false, and fast-fails over maxRetryAfterMs", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 24, 12, 0, 0));
  const firstDate = Promise.withResolvers<void>();
  let dateCalls = 0;
  const dateHandle = vi.fn(() => {
    firstDate.resolve();
    return Promise.resolve(
      dateCalls++ === 0
        ? new Response(null, {
            status: 429,
            headers: { "retry-after": "Tue, 24 Nov 2026 12:00:05 GMT" },
          })
        : new Response(null, { status: 200 }),
    );
  });
  const dateClient = createClient(
    withEndpoint(...endpoints),
    withRetry({ delayMs: 100, jitter: 0 }),
    withHTTPHandle(dateHandle),
  );
  const pendingDate = get(dateClient);
  await firstDate.promise;
  await vi.advanceTimersByTimeAsync(0);
  expect(dateHandle).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(4999);
  expect(dateHandle).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await pendingDate)[0]).toBeNull();
  expect(dateHandle).toHaveBeenCalledTimes(2);

  const disabledContexts: RetryContext[] = [];
  const firstDisabled = Promise.withResolvers<void>();
  let disabledCalls = 0;
  const disabledHandle = vi.fn(() => {
    firstDisabled.resolve();
    return Promise.resolve(
      disabledCalls++ === 0
        ? new Response(null, { status: 429, headers: { "retry-after": "30" } })
        : new Response(null, { status: 200 }),
    );
  });
  const disabledClient = createClient(
    withEndpoint(...endpoints),
    withRetry({
      delayMs: 50,
      jitter: 0,
      retryAfter: false,
      shouldRetry(context) {
        disabledContexts.push(context);
        return context.retryable;
      },
    }),
    withHTTPHandle(disabledHandle),
  );
  const pendingDisabled = get(disabledClient);
  await firstDisabled.promise;
  await vi.advanceTimersByTimeAsync(0);
  expect(disabledHandle).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(50);
  expect((await pendingDisabled)[0]).toBeNull();
  expect(disabledHandle).toHaveBeenCalledTimes(2);
  if (disabledContexts[0]?.transport === "http") {
    expect(disabledContexts[0].retryAfterMs).toBeUndefined();
  }

  const shouldRetry = vi.fn(() => true);
  const oversizedHandle = vi.fn(() =>
    Promise.resolve(
      new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    ),
  );
  const oversizedClient = createClient(
    withEndpoint(...endpoints),
    withRetry({ maxRetryAfterMs: 60_000, shouldRetry }),
    withHTTPHandle(oversizedHandle),
  );
  const [oversizedFault] = await get(oversizedClient);
  expect(oversizedFault?.code).toBe("HTTP_STATUS");
  expect(oversizedHandle).toHaveBeenCalledTimes(1);
  expect(shouldRetry).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("retries non-JSON and malformed 429 error bodies, ignores 500 truncated bodies, and leaves balancer stickiness intact", async () => {
  const errOp = defineRequest({
    method: "GET",
    path: "/",
    error: struct.object({ code: struct.string() }),
  });

  for (const responseFactory of [
    () =>
      new Response("<html>rate limited</html>", {
        status: 429,
        headers: { "content-type": "text/html", "retry-after": "0" },
      }),
    () =>
      new Response("{broken-json", {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      }),
    () =>
      Response.json(
        { wrong: 123 },
        { status: 429, headers: { "retry-after": "0" } },
      ),
  ]) {
    let calls = 0;
    const handle = vi.fn(() =>
      Promise.resolve(
        calls++ === 0 ? responseFactory() : new Response(null, { status: 200 }),
      ),
    );
    const [fault] = await errOp(setup(handle));
    expect(fault).toBeNull();
    expect(handle).toHaveBeenCalledTimes(2);
  }

  // Non-2xx stream error yields NET_BODY_INCOMPLETE (exercises non-response-fault narrowing path).
  const truncatedHandle = vi.fn(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            controller.error(new TypeError("truncated"));
          },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  const shouldRetry = vi.fn(() => true);
  const [truncatedFault] = await errOp(setup(truncatedHandle, { shouldRetry }));
  expect(truncatedFault?.code).toBe("NET_BODY_INCOMPLETE");
  expect(shouldRetry).not.toHaveBeenCalled();

  // statusOutcome(429) === undefined keeps pickFirstBalancer sticky and prevents outlierDetection ejection.
  const pickedEndpoints: string[] = [];
  let stickyCalls = 0;
  const stickyHandle = vi.fn(() =>
    Promise.resolve(
      stickyCalls++ < 6
        ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
        : new Response(null, { status: 200 }),
    ),
  );
  const stickyClient = createClient(
    withEndpoint(...endpoints),
    withBalancer(
      pickFirstBalancer({ outlierDetection: { consecutiveFailures: 2 } }),
    ),
    withRetry({ delayMs: 0, maxRetries: 2 }),
    withInterceptors(
      createHttpInterceptor((request, next) => {
        pickedEndpoints.push(request.baseEndpoint ?? "");
        return next(request);
      }),
    ),
    withHTTPHandle(stickyHandle),
  );
  await get(stickyClient);
  await get(stickyClient);
  expect(pickedEndpoints.every((ep) => ep === endpoints[0])).toBe(true);

  const rrClient = createClient(
    withEndpoint(...endpoints),
    withBalancer(roundRobinBalancer({ outlierDetection: {} })),
    withRetry({ delayMs: 0, maxRetries: 1 }),
    withHTTPHandle(() => Promise.resolve(new Response(null, { status: 429 }))),
  );
  expect((await get(rrClient))[0]?.code).toBe("HTTP_STATUS");
});

test("sets stable correlationId across retries and increments retryAttempt", async () => {
  const seen: Array<{ correlationId?: string; retryAttempt?: number }> = [];
  const handle = respond(429, 503, 200);
  const captureInterceptor = createHttpInterceptor((request, next) => {
    seen.push({
      correlationId: request.correlationId,
      retryAttempt: request.retryAttempt,
    });
    return next(request);
  });

  const noRetry = createClient(
    withEndpoint(...endpoints),
    withInterceptors(captureInterceptor),
    withHTTPHandle(() => Promise.resolve(new Response(null, { status: 200 }))),
  );
  expect((await get(noRetry))[0]).toBeNull();
  expect(seen).toHaveLength(1);
  expect(seen[0]?.correlationId).toBeTruthy();
  expect(seen[0]?.retryAttempt).toBe(0);

  seen.length = 0;
  const retried = setup(
    handle,
    { maxRetries: 3 },
    withInterceptors(captureInterceptor),
  );
  expect((await get(retried))[0]).toBeNull();
  expect(seen.map((entry) => entry.retryAttempt)).toEqual([0, 1, 2]);
  expect(seen[0]?.correlationId).toBeTruthy();
  expect(seen[1]?.correlationId).toBe(seen[0]?.correlationId);
  expect(seen[2]?.correlationId).toBe(seen[0]?.correlationId);

  seen.length = 0;
  await get(noRetry);
  const firstId = seen[0]?.correlationId;
  await get(noRetry);
  expect(seen[1]?.correlationId).not.toBe(firstId);
});
