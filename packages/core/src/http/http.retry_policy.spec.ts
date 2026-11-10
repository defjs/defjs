import { afterEach, expect, test, vi } from "vitest";
import type { RetryContext, RetryOptions } from "../client/config";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
} from "../client/option";
import { createHttpInterceptor } from "../interceptor";
import { ERR_TIMEOUT } from "../error";
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

test.each([502, 503, 504])(
  "a %i response is retried by default",
  async (status) => {
    const handle = respond(status, 200);
    expect((await get(setup(handle)))[0]).toBeNull();
    expect(handle).toHaveBeenCalledTimes(2);
  },
);

test.each([400, 404, 429, 500])(
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
  const handle = respond(429, 200);
  const client = setup(handle, {
    shouldRetry: (context) =>
      context.transport === "http" && context.status === 429,
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
