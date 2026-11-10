import { afterEach, expect, test, vi } from "vitest";
import type { RetryContext, RetryOptions } from "../client/config";
import { createClient, type Client } from "../client/client";
import {
  withEndpoint,
  withRetry,
  withWebSocketHandle,
  withWebSocketHeartbeat,
} from "../client/option";
import { struct } from "../struct";
import {
  createControllableSocketClass,
  openControllableSocket,
  type ControllableSocket,
} from "../../test/regression/controllable_socket";
import { defineWebSocket } from "./web_socket";

afterEach(() => {
  vi.useRealTimers();
});

const useSocket = defineWebSocket({
  incoming: struct.unknown(),
  outgoing: struct.object({ type: struct.literal("ping") }),
  path: "/ws",
});

function setup(options?: RetryOptions) {
  const { Socket, latest } = createControllableSocketClass();
  const sockets: ControllableSocket[] = [];
  class Recording extends Socket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols);
      const created = latest();
      if (created) sockets.push(created);
    }
  }
  return {
    latest,
    sockets,
    handle: withWebSocketHandle(Recording),
    options: options === undefined ? [] : [withRetry(options)],
  };
}

function clientOf(
  h: ReturnType<typeof setup>,
  ...extra: Parameters<typeof createClient>
) {
  return createClient(
    withEndpoint("https://ws.test"),
    h.handle,
    ...h.options,
    ...extra,
  );
}

async function opened(
  h: ReturnType<typeof setup>,
  client: Client = clientOf(h),
) {
  const [error, session] = await openControllableSocket(
    useSocket(client),
    h.latest,
  );
  if (error || !session) throw new Error("expected a session");
  return session;
}

const close = (code: number, reason = "") => ({
  code,
  reason,
  wasClean: code === 1000,
});

test("a close the caller did not request is retried and the context carries the close event", async () => {
  const contexts: RetryContext[] = [];
  const h = setup({
    delayMs: 0,
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  const session = await opened(h);
  h.sockets[0]?.triggerClose(close(1012, "restart"));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  h.sockets[1]?.triggerOpen();
  await vi.waitFor(() => expect(session.connection.generation).toBe(2));
  expect(contexts).toMatchObject([
    {
      transport: "websocket",
      attempt: 1,
      retryable: true,
      code: 1012,
      reason: "restart",
      wasClean: false,
      cause: undefined,
    },
  ]);
  session.close(1000, "done");
  h.sockets[1]?.triggerClose(close(1000, "done"));
  await session.closed;
});

test("a connection that never opened is retried too, and the count restarts after an open", async () => {
  const attempts: number[] = [];
  const h = setup({
    delayMs: 0,
    shouldRetry(context) {
      attempts.push(context.attempt);
      return true;
    },
  });
  const pending = useSocket(clientOf(h));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
  h.sockets[0]?.triggerClose(close(1006));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  h.sockets[1]?.triggerClose(close(1006));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(3));
  h.sockets[2]?.triggerOpen();
  const [error, session] = await pending;
  expect(error).toBeNull();
  expect(attempts).toEqual([1, 2]);
  h.sockets[2]?.triggerClose(close(1012));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(4));
  expect(attempts).toEqual([1, 2, 1]);
  session?.close(1000, "done");
  h.sockets[3]?.triggerClose(close(1000, "done"));
  await session?.closed;
});

test("a manual close is not retried and does not ask the policy", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const h = setup({ delayMs: 0, shouldRetry });
  const session = await opened(h);
  session.close(1000, "done");
  h.sockets[0]?.triggerClose(close(1000, "done"));
  expect(await session.closed).toMatchObject({ kind: "closed", code: 1000 });
  expect(shouldRetry).not.toHaveBeenCalled();
  expect(h.sockets).toHaveLength(1);
});

test("the policy function is not asked once maxRetries retries are made", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const h = setup({ delayMs: 0, maxRetries: 1, shouldRetry });
  const session = await opened(h);
  h.sockets[0]?.triggerClose(close(1012));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  h.sockets[1]?.triggerClose(close(1012));
  expect(await session.closed).toMatchObject({ kind: "closed", code: 1012 });
  expect(shouldRetry).toHaveBeenCalledOnce();
  expect(h.sockets).toHaveLength(2);
});

test("a policy that declines ends the session as it would end without retries", async () => {
  const h = setup({ delayMs: 0, shouldRetry: () => false });
  const session = await opened(h);
  h.sockets[0]?.triggerClose(close(1006));
  expect(await session.closed).toMatchObject({ kind: "error", code: 1006 });
  expect(h.sockets).toHaveLength(1);
});

test("an asynchronous policy function is awaited and its rejection ends the session", async () => {
  const h = setup({
    delayMs: 0,
    shouldRetry: (context) => Promise.resolve(context.attempt < 2),
  });
  const session = await opened(h);
  h.sockets[0]?.triggerClose(close(1012));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  h.sockets[1]?.triggerClose(close(1012));
  expect(await session.closed).toMatchObject({ kind: "closed", code: 1012 });
  expect(h.sockets).toHaveLength(2);

  const failure = new Error("policy failed");
  const failing = setup({
    delayMs: 0,
    shouldRetry: () => Promise.reject(failure),
  });
  const second = await opened(failing);
  failing.sockets[0]?.triggerClose(close(1012));
  expect(await second.closed).toMatchObject({ kind: "error", cause: failure });
});

test("the caller signal cancels a pending policy function", async () => {
  const controller = new AbortController();
  const h = setup({
    delayMs: 0,
    shouldRetry: () => new Promise<boolean>(() => {}),
  });
  const client = clientOf(h);
  const [, session] = await openControllableSocket(
    useSocket(client({ signal: controller.signal })),
    h.latest,
  );
  h.sockets[0]?.triggerClose(close(1012));
  controller.abort();
  expect(await session?.closed).toMatchObject({ kind: "aborted" });
});

test("request options replace the client policy and enable retries without one", async () => {
  const plain = setup();
  const noRetry = await opened(plain);
  plain.sockets[0]?.triggerClose(close(1012));
  expect(await noRetry.closed).toMatchObject({ kind: "closed" });
  expect(plain.sockets).toHaveLength(1);

  const h = setup();
  const client = clientOf(h)({ retry: { delayMs: 0, maxRetries: 1 } });
  const session = await opened(h, client);
  h.sockets[0]?.triggerClose(close(1012));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  session.close(1000, "done");
  h.sockets[1]?.triggerClose(close(1000, "done"));
  await session.closed;

  const disabled = setup({ delayMs: 0 });
  const stopped = await opened(
    disabled,
    clientOf(disabled)({ retry: { maxRetries: 0 } }),
  );
  disabled.sockets[0]?.triggerClose(close(1012));
  expect(await stopped.closed).toMatchObject({ kind: "closed" });
  expect(disabled.sockets).toHaveLength(1);
});

test("a request retry replaces the client policy as a whole, shouldRetry included", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => false);
  const h = setup({ delayMs: 0, shouldRetry });
  const session = await opened(
    h,
    clientOf(h)({ retry: { delayMs: 0, maxRetries: 1 } }),
  );
  h.sockets[0]?.triggerClose(close(1012));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  expect(shouldRetry).not.toHaveBeenCalled();
  session.close(1000, "done");
  h.sockets[1]?.triggerClose(close(1000, "done"));
  await session.closed;
});

test("an unanswered heartbeat is a connection failure that enters the retry flow", async () => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  const contexts: RetryContext[] = [];
  const h = setup({
    delayMs: 0,
    shouldRetry(context) {
      contexts.push(context);
      return context.retryable;
    },
  });
  const client = clientOf(
    h,
    withWebSocketHeartbeat({
      intervalMs: 10,
      message: () => ({ type: "ping" as const }),
      isAck: () => false,
      timeoutMs: 5,
    }),
  );
  const [error, session] = await openControllableSocket(
    useSocket(client),
    h.latest,
  );
  expect(error).toBeNull();
  await vi.advanceTimersByTimeAsync(15);
  await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
  expect(contexts).toHaveLength(1);
  expect(contexts[0]).toMatchObject({
    transport: "websocket",
    attempt: 1,
    retryable: true,
    code: undefined,
  });
  expect(contexts[0]?.cause).toEqual(new Error("WebSocket heartbeat timeout"));
  session?.close(1000, "done");
  h.sockets[1]?.triggerClose(close(1000, "done"));
  await session?.closed;
});

test("an unanswered heartbeat without a retry policy still ends the session with an error", async () => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  const h = setup();
  const client = clientOf(
    h,
    withWebSocketHeartbeat({
      intervalMs: 10,
      message: () => ({ type: "ping" as const }),
      isAck: () => false,
      timeoutMs: 5,
    }),
  );
  const [, session] = await openControllableSocket(useSocket(client), h.latest);
  await vi.advanceTimersByTimeAsync(15);
  expect(await session?.closed).toMatchObject({
    kind: "error",
    cause: new Error("WebSocket heartbeat timeout"),
  });
  expect(h.sockets).toHaveLength(1);
});

test("a heartbeat message that throws ends the session and is not retried", async () => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  const shouldRetry = vi.fn((_context: RetryContext) => true);
  const h = setup({ delayMs: 0, shouldRetry });
  const failure = new Error("message failed");
  const client = clientOf(
    h,
    withWebSocketHeartbeat({
      intervalMs: 10,
      message: () => {
        throw failure;
      },
    }),
  );
  const [, session] = await openControllableSocket(useSocket(client), h.latest);
  await vi.advanceTimersByTimeAsync(10);
  expect(await session?.closed).toMatchObject({
    kind: "error",
    cause: failure,
  });
  expect(shouldRetry).not.toHaveBeenCalled();
  expect(h.sockets).toHaveLength(1);
});

test("maxRetries 0 with attemptTimeoutMs only limits the time to open", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const h = setup({ maxRetries: 0, attemptTimeoutMs: 100 });
  const pending = useSocket(clientOf(h));
  await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending)[0]?.code).toBe("NET_TIMEOUT");
  expect(h.sockets).toHaveLength(1);
});
