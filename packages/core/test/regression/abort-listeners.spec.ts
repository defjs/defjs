import { expect, test, vi } from "vitest";
import {
  createClient,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withWebSocketHandle,
  withRetry,
} from "../../src";
import type { EventStreamHandle, WebSocketSessionLike } from "../../src";
import { createFakeWebSocket, refusing } from "../fake_web_socket";

function watch(signal: AbortSignal) {
  const add = vi.spyOn(signal, "addEventListener");
  const remove = vi.spyOn(signal, "removeEventListener");
  return {
    expectReleased() {
      const added = add.mock.calls.filter(([type]) => type === "abort");
      expect(
        remove.mock.calls.filter(([type]) => type === "abort"),
      ).toHaveLength(added.length);
      for (const [type, listener] of added) {
        expect(remove).toHaveBeenCalledWith(type, listener);
      }
      add.mockRestore();
      remove.mockRestore();
    },
  };
}

const httpEndpoint = defineRequest({
  method: "GET",
  output: struct.null(),
  path: "/",
});
const sseEndpoint = defineEventStream({
  events: { message: struct.string() },
  path: "/",
});
const socketEndpoint = defineWebSocket({
  incoming: struct.unknown(),
  path: "/",
});

/** A response that is answered when `release` is called, so that the caller can stop the call first. */
function heldResponse(answer: () => Response): {
  response: Promise<Response>;
  release: () => void;
} {
  let release: () => void = () => undefined;
  const response = new Promise<Response>((resolve) => {
    release = () => resolve(answer());
  });
  return { response, release };
}

const answered = (response: Response) => ({
  response: Promise.resolve(response),
  release: () => undefined,
});

const jsonNull = () =>
  new Response("null", { headers: { "content-type": "application/json" } });
const eventStream = () =>
  new Response("data: hi\n\n", {
    headers: { "content-type": "text/event-stream" },
  });

const deadline = () => new DOMException("deadline", "TimeoutError");

test.each([
  {
    outcome: "success",
    serve: () => answered(jsonNull()),
    stop: undefined,
    code: null,
  },
  {
    outcome: "fault",
    serve: () => answered(new Response(null, { status: 500 })),
    stop: undefined,
    code: "HTTP_STATUS",
  },
  {
    outcome: "abort",
    serve: () => heldResponse(jsonNull),
    stop: "stop",
    code: "NET_ABORTED",
  },
  {
    outcome: "timeout",
    serve: () => heldResponse(jsonNull),
    stop: deadline(),
    code: "NET_TIMEOUT",
  },
])(
  "HTTP releases caller abort listeners after $outcome",
  async ({ serve, stop, code }) => {
    const served = serve();
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => served.response),
    );
    const caller = new AbortController();
    const signal = watch(caller.signal);
    const pending = httpEndpoint(client({ signal: caller.signal }));
    if (stop !== undefined) caller.abort(stop);
    const [fault] = await pending;
    served.release();
    expect(fault?.code ?? null).toBe(code);
    signal.expectReleased();
  },
);

test("SSE releases caller abort listeners after a reconnecting stream closes", async () => {
  let attempt = 0;
  const client = createClient(
    withEndpoint("https://example.test"),
    withRetry({ maxRetries: 1, delayMs: 0 }),
    withSSEHandle(() => {
      attempt += 1;
      if (attempt === 1) {
        let sent = false;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(
                    new TextEncoder().encode("id: 1\ndata: first\n\n"),
                  );
                } else {
                  controller.error(new Error("connection lost"));
                }
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      }
      return Promise.resolve(
        new Response("data: second\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }),
  );
  const caller = new AbortController();
  const signal = watch(caller.signal);
  const [fault, stream] = await sseEndpoint(client({ signal: caller.signal }));
  expect(fault).toBeNull();
  if (!stream) throw new Error("Expected an SSE stream");
  const values: string[] = [];
  for await (const event of stream) values.push(event.data);
  await stream.closed;
  expect(values).toEqual(["first", "second"]);
  signal.expectReleased();
});

test.each([
  {
    outcome: "fault",
    serve: () => answered(new Response(null, { status: 500 })),
    stop: undefined,
    code: "HTTP_STATUS",
  },
  {
    outcome: "abort",
    serve: () => heldResponse(eventStream),
    stop: "stop",
    code: "NET_ABORTED",
  },
  {
    outcome: "timeout",
    serve: () => heldResponse(eventStream),
    stop: deadline(),
    code: "NET_TIMEOUT",
  },
])(
  "SSE releases caller abort listeners after $outcome",
  async ({ serve, stop, code }) => {
    const served = serve();
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() => served.response),
    );
    const caller = new AbortController();
    const signal = watch(caller.signal);
    const pending = sseEndpoint(client({ signal: caller.signal }));
    if (stop !== undefined) caller.abort(stop);
    const [fault] = await pending;
    served.release();
    expect(fault?.code).toBe(code);
    signal.expectReleased();
  },
);

test("SSE closes an opened stream and releases caller listeners when the interceptor fails after opening", async () => {
  let opened: EventStreamHandle<unknown> | undefined;
  const client = createClient(
    withEndpoint("https://example.test"),
    withSSEHandle(() =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    ),
    withInterceptors(
      createSSEInterceptor(async (request, next) => {
        opened = await next(request);
        throw new Error("the interceptor fails after opening");
      }),
    ),
  );
  const caller = new AbortController();
  const signal = watch(caller.signal);
  const [fault, stream] = await sseEndpoint(client({ signal: caller.signal }));
  expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
  expect(stream).toBeUndefined();
  expect(opened).toBeDefined();
  await expect(opened?.closed).resolves.toMatchObject({ kind: "aborted" });
  signal.expectReleased();
});

test("WebSocket closes an opened session and releases caller listeners when the interceptor fails after opening", async () => {
  let opened: WebSocketSessionLike | undefined;
  const fake = createFakeWebSocket();
  const client = createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(fake.Socket),
    withInterceptors(
      createWebSocketInterceptor(async (request, next) => {
        opened = await next(request);
        throw new Error("the interceptor fails after opening");
      }),
    ),
  );
  const caller = new AbortController();
  const signal = watch(caller.signal);
  const [fault, session] = await socketEndpoint(
    client({ signal: caller.signal }),
  );
  expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
  expect(session).toBeUndefined();
  expect(opened).toBeDefined();
  await expect(opened?.closed).resolves.toMatchObject({ kind: "aborted" });
  signal.expectReleased();
});

test.each(["success", "fault", "abort", "timeout"] as const)(
  "WebSocket releases caller abort listeners after %s",
  async (mode) => {
    // An aborted call is one whose socket never opens.
    const fake = createFakeWebSocket({
      handshake: mode === "abort" || mode === "timeout" ? "manual" : "auto",
    });
    const Socket = mode === "fault" ? refusing(fake.Socket) : fake.Socket;
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(Socket),
    );
    const caller = new AbortController();
    const signal = watch(caller.signal);
    const pending = socketEndpoint(
      client({
        signal: caller.signal,
      }),
    );
    if (mode === "abort") caller.abort("stop");
    if (mode === "timeout") {
      caller.abort(new DOMException("deadline", "TimeoutError"));
    }
    const [fault, session] = await pending;
    if (mode === "success") {
      if (!session) throw new Error("Expected a WebSocket session");
      session.close();
      await session.closed;
    }
    if (mode === "success") expect(fault).toBeNull();
    else if (mode === "abort") expect(fault?.code).toBe("NET_ABORTED");
    else if (mode === "timeout") expect(fault?.code).toBe("NET_TIMEOUT");
    else expect(fault).toBeTruthy();
    signal.expectReleased();
  },
);
