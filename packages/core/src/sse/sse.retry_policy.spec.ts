import { expect, test, vi } from "vitest";
import type { RetryContext, RetryOptions } from "../client/config";
import { createClient } from "../client/client";
import { withEndpoint, withRetry, withSSEHandle } from "../client/option";
import { struct } from "../struct";
import { defineEventStream } from "./sse";

const HEADERS = { "content-type": "text/event-stream" };

function body(text: string, failure?: unknown): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(text));
        return;
      }
      if (failure === undefined) controller.close();
      else controller.error(failure);
    },
  });
}

type Step = Error | (() => Response);

function handleOf(...steps: Step[]) {
  let calls = 0;
  return vi.fn(() => {
    const step = steps[Math.min(calls++, steps.length - 1)];
    return step instanceof Error
      ? Promise.reject(step)
      : Promise.resolve(step?.() ?? new Response(null));
  });
}

const ok =
  (text = "data: a\n\n"): Step =>
  () =>
    new Response(body(text), { headers: HEADERS });
const drop =
  (text = "id: 7\ndata: a\n\n"): Step =>
  () =>
    new Response(body(text, new TypeError("connection reset")), {
      headers: HEADERS,
    });
const status =
  (code: number): Step =>
  () =>
    new Response("busy", { status: code });

const read = defineEventStream({
  path: "/",
  events: { message: struct.string() },
});

function setup(
  handle: ReturnType<typeof handleOf>,
  options: RetryOptions = {},
  method = "GET",
) {
  const operation =
    method === "GET"
      ? read
      : defineEventStream({
          path: "/",
          method,
          events: { message: struct.string() },
        });
  return {
    operation,
    client: createClient(
      withEndpoint("https://api.test"),
      withSSEHandle(handle),
      withRetry({ delayMs: 0, ...options }),
    ),
  };
}

async function drain(stream: AsyncIterable<unknown> | undefined) {
  const seen: unknown[] = [];
  if (stream === undefined) return seen;
  try {
    for await (const event of stream) seen.push(event);
  } catch {
    // The close info carries the failure.
  }
  return seen;
}

test("a refused handshake gives the policy a context with the request facts", async () => {
  const contexts: RetryContext[] = [];
  const handle = handleOf(new TypeError("refused"), ok());
  const { operation, client } = setup(handle, {
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  const [fault, stream] = await operation(client);
  expect(fault).toBeNull();
  await drain(stream);
  expect(contexts).toHaveLength(1);
  expect(contexts[0]).toMatchObject({
    transport: "sse",
    attempt: 1,
    retryable: true,
    method: "GET",
    lastEventId: "",
    status: undefined,
    open: undefined,
  });
  expect(contexts[0]?.cause).toEqual(new TypeError("refused"));
});

test.each([502, 503, 504])(
  "a %i handshake is retried by default",
  async (code) => {
    const contexts: RetryContext[] = [];
    const handle = handleOf(status(code), ok());
    const { operation, client } = setup(handle, {
      shouldRetry(context) {
        contexts.push(context);
        return context.retryable;
      },
    });
    const [fault, stream] = await operation(client);
    expect(fault).toBeNull();
    await drain(stream);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(contexts[0]).toMatchObject({ status: code, retryable: true });
    expect(contexts[0]?.cause).toMatchObject({ code: "HTTP_STATUS" });
  },
);

test("a stream that fails after it opened is retried with its last event id", async () => {
  const contexts: RetryContext[] = [];
  const handle = handleOf(drop(), ok("data: b\n\n"));
  const { operation, client } = setup(handle, {
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  const [fault, stream] = await operation(client);
  expect(fault).toBeNull();
  expect(await drain(stream)).toHaveLength(2);
  expect(handle).toHaveBeenCalledTimes(2);
  expect(contexts[0]).toMatchObject({
    transport: "sse",
    attempt: 1,
    retryable: true,
    lastEventId: "7",
    status: 200,
  });
  expect(
    contexts[0]?.transport === "sse" && contexts[0].open?.response.status,
  ).toBe(200);
});

test("a normal end of the stream is not a failure", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const handle = handleOf(ok());
  const { operation, client } = setup(handle, { shouldRetry });
  const [, stream] = await operation(client);
  await drain(stream);
  expect(await stream?.closed).toEqual({ kind: "eof" });
  expect(shouldRetry).not.toHaveBeenCalled();
  expect(handle).toHaveBeenCalledOnce();
});

test.each([400, 404, 429, 500])(
  "a %i handshake is not retried by default",
  async (code) => {
    const contexts: RetryContext[] = [];
    const handle = handleOf(status(code), ok());
    const { operation, client } = setup(handle, {
      shouldRetry(context) {
        contexts.push(context);
        return context.retryable;
      },
    });
    expect((await operation(client))[0]).toMatchObject({
      code: "HTTP_STATUS",
      status: code,
    });
    expect(handle).toHaveBeenCalledOnce();
    expect(contexts).toMatchObject([{ status: code, retryable: false }]);
  },
);

test("the policy function can retry a status the default does not", async () => {
  const handle = handleOf(status(429), ok());
  const { operation, client } = setup(handle, {
    shouldRetry: (context) =>
      context.transport === "sse" && context.status === 429,
  });
  const [fault, stream] = await operation(client);
  expect(fault).toBeNull();
  await drain(stream);
  expect(handle).toHaveBeenCalledTimes(2);
});

test.each([
  ["GET", true],
  ["PUT", true],
  ["DELETE", true],
  ["POST", false],
  ["PATCH", false],
] as const)("the default methods decide %s: %s", async (method, retried) => {
  const handle = handleOf(new TypeError("refused"), ok());
  const contexts: RetryContext[] = [];
  const { operation, client } = setup(
    handle,
    {
      shouldRetry(context) {
        contexts.push(context);
        return context.retryable;
      },
    },
    method,
  );
  const [fault, stream] = await operation(client);
  expect(fault === null).toBe(retried);
  await drain(stream);
  expect(handle).toHaveBeenCalledTimes(retried ? 2 : 1);
  expect(contexts[0]).toMatchObject({ method, retryable: retried });
});

test("a fatal error is not given to the policy function", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const handle = handleOf(
    () =>
      new Response(body("data: a\n\n"), {
        headers: { "content-type": "text/plain" },
      }),
  );
  const { operation, client } = setup(handle, { shouldRetry });
  expect((await operation(client))[0]?.code).toBe("RES_MEDIA_TYPE_INVALID");
  expect(shouldRetry).not.toHaveBeenCalled();
  expect(handle).toHaveBeenCalledOnce();
});

test("the policy function is not asked once maxRetries retries are made", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const handle = handleOf(new TypeError("refused"));
  const { operation, client } = setup(handle, { maxRetries: 2, shouldRetry });
  expect((await operation(client))[0]?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(3);
  expect(shouldRetry.mock.calls.map(([context]) => context.attempt)).toEqual([
    1, 2,
  ]);
});

test("a policy function that throws ends the stream with that error", async () => {
  const handle = handleOf(drop());
  const failure = new Error("policy failed");
  const { operation, client } = setup(handle, {
    shouldRetry() {
      throw failure;
    },
  });
  const [fault, stream] = await operation(client);
  expect(fault).toBeNull();
  await drain(stream);
  expect(await stream?.closed).toMatchObject({ kind: "error", cause: failure });
  expect(handle).toHaveBeenCalledOnce();
});

test("an asynchronous policy function is awaited and the caller signal cancels it", async () => {
  const handle = handleOf(drop(), ok());
  const { operation, client } = setup(handle, {
    shouldRetry: (context) => Promise.resolve(context.retryable),
  });
  const [, stream] = await operation(client);
  expect(await drain(stream)).toHaveLength(2);

  const controller = new AbortController();
  const pending = setup(handleOf(drop()), {
    shouldRetry: () => new Promise<boolean>(() => {}),
  });
  const [, hanging] = await pending.operation(
    pending.client({ signal: controller.signal }),
  );
  const consumed = drain(hanging);
  await vi.waitFor(() => expect(controller.signal.aborted).toBe(false));
  controller.abort();
  await consumed;
  expect(await hanging?.closed).toMatchObject({ kind: "aborted" });
});

test("request options replace the client policy and enable retries without one", async () => {
  const handle = handleOf(
    new TypeError("refused"),
    new TypeError("refused"),
    ok(),
  );
  const plain = createClient(
    withEndpoint("https://api.test"),
    withSSEHandle(handle),
  );
  expect((await read(plain))[0]?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledOnce();
  const [fault, stream] = await read(
    plain({ retry: { delayMs: 0, maxRetries: 1 } }),
  );
  expect(fault).toBeNull();
  await drain(stream);
  expect(handle).toHaveBeenCalledTimes(3);
  const stopped = handleOf(new TypeError("refused"), ok());
  const configured = setup(stopped);
  expect(
    (await read(configured.client({ retry: { maxRetries: 0 } })))[0]?.code,
  ).toBe("NET_UNREACHABLE");
  expect(stopped).toHaveBeenCalledOnce();
});

test("a request retry replaces the client policy as a whole, shouldRetry included", async () => {
  const handle = handleOf(new TypeError("refused"), ok());
  const shouldRetry = vi.fn((_context: RetryContext) => false);
  const configured = setup(handle, { shouldRetry });
  const [fault, stream] = await read(
    configured.client({ retry: { delayMs: 0, maxRetries: 1 } }),
  );
  expect(fault).toBeNull();
  await drain(stream);
  expect(handle).toHaveBeenCalledTimes(2);
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("maxRetries 0 with attemptTimeoutMs only limits the handshake", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const handle = vi.fn(() => new Promise<Response>(() => {}));
    const client = createClient(
      withEndpoint("https://api.test"),
      withSSEHandle(handle),
      withRetry({ maxRetries: 0, attemptTimeoutMs: 100 }),
    );
    const pending = read(client);
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
    expect(handle).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
