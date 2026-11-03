import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import type {
  EndpointBalancer,
  EndpointDoneInfo,
  EndpointPickInfo,
  EndpointPickOutcome,
} from "../balancer";
import { pickFirstBalancer } from "../balancer";
import {
  createClient,
  withEndpoint,
  withEndpointBalancer,
  withInterceptors,
  withSSEHandle,
  withSSEReconnect,
} from "../client";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { createPreflightFault } from "../error/factory";
import { createSSEInterceptor } from "../interceptor";
import { RequestUrlError } from "../internal/url";
import { struct } from "../struct";
import { defineEventStream } from "./index";

const SSE_HEADERS = { "content-type": "text/event-stream" };
const RECONNECT = { attempts: 1, delayMs: 0, factor: 1 };

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  const pending = closers.splice(0);
  await Promise.all(pending.map((close) => close()));
});

interface Running {
  url: string;
  requests: string[];
  close(): Promise<void>;
  endHeld(): void;
}

function listen(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Running> {
  const requests: string[] = [];
  let held: ServerResponse | undefined;
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    held = res;
    handle(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a TCP port");
      }
      const running: Running = {
        url: `http://127.0.0.1:${address.port}`,
        requests,
        endHeld() {
          held?.end();
        },
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      };
      closers.push(() => running.close());
      resolve(running);
    });
  });
}

function writeEvent(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
  res.write("data: hi\n\n");
}

interface Recorded {
  balancer: EndpointBalancer;
  picks: EndpointPickInfo[];
  dones: Array<{ endpoint: string; info: EndpointDoneInfo }>;
  pending(): number;
}

function track(
  choose: (
    index: number,
    info: EndpointPickInfo,
  ) => string | EndpointPickOutcome,
): Recorded {
  const picks: EndpointPickInfo[] = [];
  const dones: Array<{ endpoint: string; info: EndpointDoneInfo }> = [];
  let pending = 0;
  return {
    picks,
    dones,
    pending: () => pending,
    balancer: {
      pick(info) {
        picks.push(info);
        const choice = choose(picks.length, info);
        if (typeof choice !== "string") {
          return choice;
        }
        pending += 1;
        return [
          null,
          {
            endpoint: choice,
            done(doneInfo) {
              pending -= 1;
              dones.push({ endpoint: choice, info: doneInfo });
            },
          },
        ];
      },
    },
  };
}

function expectPicks(recorded: Recorded, operation = "orders"): void {
  expect(recorded.picks.length).toBeGreaterThan(0);
  for (const pick of recorded.picks) {
    expect(pick.transport).toBe("sse");
    expect(pick.operation).toBe(operation);
  }
}

const orders = defineEventStream({
  events: { message: struct.string() },
  operation: "orders",
  path: "/events",
});

function sseResponse(body: string, status = 200): Response {
  return new Response(body, { headers: SSE_HEADERS, status });
}

test("repicks after a read failure when reconnect is on, and does not pick on terminal paths", async () => {
  const primary = await listen((_req, res) => {
    writeEvent(res);
    setImmediate(() => res.destroy());
  });
  const secondary = await listen((_req, res) => {
    writeEvent(res);
    res.end();
  });
  const recorded = track((index) =>
    index === 1 ? primary.url : secondary.url,
  );
  const client = createClient(
    withEndpoint(primary.url, secondary.url),
    withEndpointBalancer(recorded.balancer),
    withSSEReconnect(RECONNECT),
  );
  const [error, stream] = await orders(client);
  expect(error).toBeNull();
  if (!stream) {
    throw new Error("expected a stream");
  }
  await stream.closed;
  expect(recorded.picks).toHaveLength(2);
  expect(primary.requests).toHaveLength(1);
  expect(secondary.requests).toHaveLength(1);
  expect(recorded.dones[0]?.info).toEqual({ attempted: true, status: 200 });
  expect(recorded.dones[1]?.info).toEqual({ attempted: true, status: 200 });
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);

  const eof = await listen((_req, res) => {
    writeEvent(res);
    res.end();
  });
  const eofRecord = track(() => eof.url);
  const eofClient = createClient(
    withEndpoint(eof.url),
    withEndpointBalancer(eofRecord.balancer),
    withSSEReconnect(RECONNECT),
  );
  const [eofError, eofStream] = await orders(eofClient);
  expect(eofError).toBeNull();
  await eofStream?.closed;
  expect(eofRecord.picks).toHaveLength(1);
  expect(eof.requests).toHaveLength(1);

  const refused = await listen((_req, res) => {
    res.writeHead(500, SSE_HEADERS);
    res.end();
  });
  const plain = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("nope");
  });
  for (const [server, definition] of [
    [
      refused,
      defineEventStream({
        events: { message: struct.string() },
        operation: "orders",
        path: "/events",
      }),
    ],
    [
      plain,
      defineEventStream({
        events: { message: struct.string() },
        operation: "orders",
        path: "/events",
      }),
    ],
  ] as const) {
    const terminal = track(() => server.url);
    const [terminalError] = await definition(
      createClient(
        withEndpoint(server.url),
        withEndpointBalancer(terminal.balancer),
        withSSEReconnect(RECONNECT),
      ),
    );
    expect(terminalError?.code).not.toBeUndefined();
    expect(terminal.picks).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
    expect(terminal.pending()).toBe(0);
  }

  const huge = await listen((_req, res) => {
    res.writeHead(200, SSE_HEADERS);
    res.end(`data: ${"x".repeat(64)}\n\n`);
  });
  const hugeRecord = track(() => huge.url);
  const hugeStream = defineEventStream({
    events: { message: struct.string() },
    maxBufferSize: 16,
    operation: "orders",
    path: "/events",
  });
  const [hugeError, hugeHandle] = await hugeStream(
    createClient(
      withEndpoint(huge.url),
      withEndpointBalancer(hugeRecord.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(hugeError).toBeNull();
  expect(await hugeHandle?.closed).toMatchObject({
    code: "CAP_BUFFER_EXCEEDED",
    kind: "error",
  });
  expect(hugeRecord.picks).toHaveLength(1);
  expect(hugeRecord.dones).toEqual([
    { endpoint: huge.url, info: { attempted: true, status: 200 } },
  ]);
  expect(hugeRecord.pending()).toBe(0);

  const dropped = await listen((_req, res) => {
    writeEvent(res);
    setImmediate(() => res.destroy());
  });
  const quiet = track(() => dropped.url);
  const [quietError, quietStream] = await orders(
    createClient(
      withEndpoint(dropped.url),
      withEndpointBalancer(quiet.balancer),
    ),
  );
  expect(quietError).toBeNull();
  await quietStream?.closed;
  expect(quiet.picks).toHaveLength(1);
  expect(dropped.requests).toHaveLength(1);

  const postServer = await listen((_req, res) => {
    writeEvent(res);
    setImmediate(() => res.destroy());
  });
  const post = defineEventStream({
    events: { message: struct.string() },
    method: "POST",
    operation: "orders",
    path: "/events",
  });
  const postRecord = track(() => postServer.url);
  const [postError, postStream] = await post(
    createClient(
      withEndpoint(postServer.url),
      withEndpointBalancer(postRecord.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(postError).toBeNull();
  await postStream?.closed;
  expect(postRecord.picks).toHaveLength(1);
  expect(postServer.requests).toHaveLength(1);

  const allowed = await listen((req, res) => {
    writeEvent(res);
    if (req.method === "POST" && allowed.requests.length === 1) {
      setImmediate(() => res.destroy());
      return;
    }
    res.end();
  });
  const allowedRecord = track((index) =>
    index === 1 ? allowed.url : allowed.url,
  );
  const [allowedError, allowedStream] = await post(
    createClient(
      withEndpoint(allowed.url),
      withEndpointBalancer(allowedRecord.balancer),
      withSSEReconnect({ ...RECONNECT, shouldReconnect: () => true }),
    ),
  );
  expect(allowedError).toBeNull();
  await allowedStream?.closed;
  expect(allowedRecord.picks).toHaveLength(2);
  expect(allowed.requests).toHaveLength(2);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const streamBody = defineEventStream({
    builder: () => ({ body }),
    events: { message: struct.string() },
    method: "POST",
    operation: "orders",
    path: "/events",
  });
  const handle = vi.fn(async () => {
    throw new TypeError("down");
  });
  const streamRecord = track(() => "https://example.com");
  const [streamError] = await streamBody(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(streamRecord.balancer),
      withSSEHandle(handle),
      withSSEReconnect({ ...RECONNECT, shouldReconnect: () => true }),
    ),
  );
  expect(streamError?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(1);
  expect(streamRecord.picks).toHaveLength(1);
  expect(streamRecord.pending()).toBe(0);

  const held = await listen(() => undefined);
  const cancelRecord = track(() => held.url);
  const controller = new AbortController();
  const pending = orders(
    createClient(
      withEndpoint(held.url),
      withEndpointBalancer(cancelRecord.balancer),
      withSSEReconnect(RECONNECT),
    )({ signal: controller.signal }),
  );
  await vi.waitFor(() => expect(held.requests).toHaveLength(1));
  controller.abort(ERR_ABORTED);
  const [cancelError] = await pending;
  expect(cancelError?.code).toBe("NET_ABORTED");
  expect(cancelRecord.picks).toHaveLength(1);
  expect(cancelRecord.dones).toEqual([
    { endpoint: held.url, info: { attempted: false } },
  ]);
  expect(cancelRecord.pending()).toBe(0);
});

test("calls done when the connection ends, not when the handshake succeeds", async () => {
  const held = await listen((_req, res) => {
    writeEvent(res);
  });
  const recorded = track(() => held.url);
  const [error, stream] = await orders(
    createClient(
      withEndpoint(held.url),
      withEndpointBalancer(recorded.balancer),
    ),
  );
  expect(error).toBeNull();
  if (!stream) {
    throw new Error("expected a stream");
  }
  expect(recorded.dones).toHaveLength(0);
  expect(recorded.pending()).toBe(1);
  held.endHeld();
  await stream.closed;
  expect(recorded.dones).toEqual([
    { endpoint: held.url, info: { attempted: true, status: 200 } },
  ]);
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);
});

test("reports REQ_BUILD_FAILED when a reconnect pick fails before open", async () => {
  const down = await listen((req) => {
    req.socket.destroy();
  });
  const cause = new Error("no endpoint");
  const recorded = track((index) =>
    index === 1 ? down.url : [cause, undefined],
  );
  const [error] = await orders(
    createClient(
      withEndpoint(down.url),
      withEndpointBalancer(recorded.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(error?.code).toBe("REQ_BUILD_FAILED");
  expect(error?.cause).toBe(cause);
  expect(error?.code).not.toBe("NET_UNREACHABLE");
  expect(error?.code).not.toBe("EXT_INTERCEPTOR_FAILED");
  expect(recorded.picks).toHaveLength(2);
  expect(recorded.dones).toEqual([
    { endpoint: down.url, info: { attempted: true, code: "NET_UNREACHABLE" } },
  ]);
  expect(recorded.pending()).toBe(0);

  const broken = pickFirstBalancer({ shuffle: 1 as unknown as boolean });
  const options = track((index, info) =>
    index === 1 ? down.url : broken.pick(info),
  );
  const [optionError] = await orders(
    createClient(
      withEndpoint(down.url),
      withEndpointBalancer(options.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(optionError?.code).toBe("REQ_OPTIONS_INVALID");
  expect(optionError?.code).not.toBe("NET_UNREACHABLE");
  expect(options.pending()).toBe(0);
  expectPicks(recorded);
});

test("reports REQ_BUILD_FAILED on closed when a reconnect pick fails after open", async () => {
  const dropped = await listen((_req, res) => {
    writeEvent(res);
    setImmediate(() => res.destroy());
  });
  const cause = new Error("no endpoint");
  const recorded = track((index) =>
    index === 1 ? dropped.url : [cause, undefined],
  );
  const [error, stream] = await orders(
    createClient(
      withEndpoint(dropped.url),
      withEndpointBalancer(recorded.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(error).toBeNull();
  const closed = await stream?.closed;
  expect(closed).toMatchObject({
    cause: expect.objectContaining({ cause, code: "REQ_BUILD_FAILED" }),
    code: "REQ_BUILD_FAILED",
    kind: "error",
  });
  expect(recorded.pending()).toBe(0);

  const broken = pickFirstBalancer({ shuffle: 1 as unknown as boolean });
  const options = track((index, info) =>
    index === 1 ? dropped.url : broken.pick(info),
  );
  const [optionError, optionStream] = await orders(
    createClient(
      withEndpoint(dropped.url),
      withEndpointBalancer(options.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(optionError).toBeNull();
  expect(await optionStream?.closed).toMatchObject({
    code: "REQ_OPTIONS_INVALID",
    kind: "error",
  });
  expect(options.pending()).toBe(0);
  expectPicks(recorded);
});

test("calls done once when a reconnect url fails and releases the in-flight count", async () => {
  const down = await listen((req) => {
    req.socket.destroy();
  });
  const bad = "http://[";
  const recorded = track((index) => (index === 1 ? down.url : bad));
  const [error] = await orders(
    createClient(
      withEndpoint(down.url, bad),
      withEndpointBalancer(recorded.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(error?.code).toBe("REQ_BUILD_FAILED");
  expect(error?.cause).toBeInstanceOf(RequestUrlError);
  expect(recorded.dones).toEqual([
    { endpoint: down.url, info: { attempted: true, code: "NET_UNREACHABLE" } },
    { endpoint: bad, info: { attempted: false } },
  ]);
  expect(recorded.pending()).toBe(0);
  expect(recorded.picks).toHaveLength(2);

  const opened = await listen((_req, res) => {
    writeEvent(res);
    setImmediate(() => res.destroy());
  });
  const afterOpen = track((index) => (index === 1 ? opened.url : bad));
  const [openError, stream] = await orders(
    createClient(
      withEndpoint(opened.url, bad),
      withEndpointBalancer(afterOpen.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(openError).toBeNull();
  await stream?.closed;
  expect(afterOpen.dones.filter((entry) => entry.endpoint === bad)).toEqual([
    { endpoint: bad, info: { attempted: false } },
  ]);
  expect(afterOpen.pending()).toBe(0);
  expect(afterOpen.picks).toHaveLength(2);
  expectPicks(recorded);
});

test("attributes timeouts and cancellations before fetch, before headers, and after handshake", async () => {
  const handle = vi.fn(async () => sseResponse("data: hi\n\n"));
  const beforeTimeout = new AbortController();
  const beforeTimeoutRecord = track(() => "https://example.com");
  const [timeoutBefore] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(beforeTimeoutRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          beforeTimeout.abort(ERR_TIMEOUT);
          return next(req);
        }),
      ),
    )({ signal: beforeTimeout.signal }),
  );
  expect(timeoutBefore?.code).toBe("NET_TIMEOUT");
  expect(handle).not.toHaveBeenCalled();
  expect(beforeTimeoutRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(beforeTimeoutRecord.pending()).toBe(0);

  const beforeCancel = new AbortController();
  const beforeCancelRecord = track(() => "https://example.com");
  const [cancelBefore] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(beforeCancelRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          beforeCancel.abort(ERR_ABORTED);
          return next(req);
        }),
      ),
    )({ signal: beforeCancel.signal }),
  );
  expect(cancelBefore?.code).toBe("NET_ABORTED");
  expect(handle).not.toHaveBeenCalled();
  expect(beforeCancelRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);

  const timeoutHeaders = new AbortController();
  const timeoutServer = await listen(() => {
    timeoutHeaders.abort(ERR_TIMEOUT);
  });
  const timeoutHeadersRecord = track(() => timeoutServer.url);
  const [timeoutDuring] = await orders(
    createClient(
      withEndpoint(timeoutServer.url),
      withEndpointBalancer(timeoutHeadersRecord.balancer),
    )({ signal: timeoutHeaders.signal }),
  );
  expect(timeoutDuring?.code).toBe("NET_TIMEOUT");
  expect(timeoutServer.requests).toHaveLength(1);
  expect(timeoutHeadersRecord.dones).toEqual([
    {
      endpoint: timeoutServer.url,
      info: { attempted: true, code: "NET_TIMEOUT" },
    },
  ]);
  expect(timeoutHeadersRecord.pending()).toBe(0);

  const cancelHeaders = new AbortController();
  const cancelServer = await listen(() => {
    cancelHeaders.abort(ERR_ABORTED);
  });
  const cancelHeadersRecord = track(() => cancelServer.url);
  const [cancelDuring] = await orders(
    createClient(
      withEndpoint(cancelServer.url),
      withEndpointBalancer(cancelHeadersRecord.balancer),
    )({ signal: cancelHeaders.signal }),
  );
  expect(cancelDuring?.code).toBe("NET_ABORTED");
  expect(cancelHeadersRecord.dones).toEqual([
    { endpoint: cancelServer.url, info: { attempted: false } },
  ]);

  const heldTimeout = await listen((_req, res) => {
    writeEvent(res);
  });
  const heldTimeoutRecord = track(() => heldTimeout.url);
  const timeoutAfter = new AbortController();
  const [heldTimeoutError, heldTimeoutStream] = await orders(
    createClient(
      withEndpoint(heldTimeout.url),
      withEndpointBalancer(heldTimeoutRecord.balancer),
    )({ signal: timeoutAfter.signal }),
  );
  expect(heldTimeoutError).toBeNull();
  expect(heldTimeoutRecord.dones).toHaveLength(0);
  timeoutAfter.abort(ERR_TIMEOUT);
  expect(await heldTimeoutStream?.closed).toMatchObject({
    code: "NET_TIMEOUT",
    kind: "error",
  });
  expect(heldTimeoutRecord.dones).toEqual([
    {
      endpoint: heldTimeout.url,
      info: { attempted: true, code: "NET_TIMEOUT" },
    },
  ]);
  expect(heldTimeoutRecord.pending()).toBe(0);

  const heldCancel = await listen((_req, res) => {
    writeEvent(res);
  });
  const heldCancelRecord = track(() => heldCancel.url);
  const [heldCancelError, heldCancelStream] = await orders(
    createClient(
      withEndpoint(heldCancel.url),
      withEndpointBalancer(heldCancelRecord.balancer),
    ),
  );
  expect(heldCancelError).toBeNull();
  heldCancelStream?.close();
  await vi.waitFor(() => expect(heldCancelRecord.dones).toHaveLength(1));
  expect(heldCancelRecord.dones).toEqual([
    { endpoint: heldCancel.url, info: { attempted: false } },
  ]);
  expect(heldCancelRecord.pending()).toBe(0);

  const thrownTimeout = track(() => "https://example.com");
  const [thrownTimeoutError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(thrownTimeout.balancer),
      withSSEHandle(async () => {
        throw ERR_TIMEOUT;
      }),
    ),
  );
  expect(thrownTimeoutError?.code).toBe("NET_TIMEOUT");
  expect(thrownTimeout.dones).toEqual([
    {
      endpoint: "https://example.com",
      info: { attempted: true, code: "NET_TIMEOUT" },
    },
  ]);

  const thrownAbort = track(() => "https://example.com");
  const [thrownAbortError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(thrownAbort.balancer),
      withSSEHandle(async () => {
        throw ERR_ABORTED;
      }),
    ),
  );
  expect(thrownAbortError?.code).toBe("NET_ABORTED");
  expect(thrownAbort.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);

  const coded = Object.assign(new Error("nope"), { code: "NOPE" });
  const thrownCoded = track(() => "https://example.com");
  const [codedError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(thrownCoded.balancer),
      withSSEHandle(async () => {
        throw coded;
      }),
    ),
  );
  expect(codedError?.code).toBe("NET_UNREACHABLE");
  expect(thrownCoded.dones).toEqual([
    {
      endpoint: "https://example.com",
      info: { attempted: true, code: "NET_UNREACHABLE" },
    },
  ]);

  expectPicks(beforeTimeoutRecord);
});

test("calls done once when sseHandler sees a replaced base and does not record its status", async () => {
  const origin = await listen((_req, res) => {
    res.writeHead(200, SSE_HEADERS);
    res.end("data: origin\n\n");
  });
  const replaced = await listen((_req, res) => {
    res.writeHead(503, SSE_HEADERS);
    res.end();
  });
  const recorded = track(() => origin.url);
  const [error, stream, open] = await orders(
    createClient(
      withEndpoint(origin.url),
      withEndpointBalancer(recorded.balancer),
      withSSEReconnect(RECONNECT),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          req.baseEndpoint = replaced.url;
          return next(req);
        }),
      ),
    ),
  );
  expect(stream).toBeUndefined();
  expect(error?.code).toBe("HTTP_STATUS");
  expect(open?.response.status).toBe(503);
  expect(origin.requests).toHaveLength(0);
  expect(replaced.requests).toHaveLength(1);
  expect(recorded.dones).toEqual([
    { endpoint: origin.url, info: { attempted: false } },
  ]);
  expect(recorded.picks).toHaveLength(1);
  expect(recorded.pending()).toBe(0);

  const dropping = await listen((req) => {
    req.socket.destroy();
  });
  const again = track(() => origin.url);
  const [againError, againStream] = await orders(
    createClient(
      withEndpoint(origin.url),
      withEndpointBalancer(again.balancer),
      withSSEReconnect(RECONNECT),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          req.baseEndpoint = dropping.url;
          return next(req);
        }),
      ),
    ),
  );
  expect(againError).not.toBeNull();
  expect(againStream).toBeUndefined();
  expect(again.picks).toHaveLength(1);
  expect(dropping.requests.length).toBeGreaterThan(1);
  expect(again.dones).toEqual([
    { endpoint: origin.url, info: { attempted: false } },
  ]);
  expect(again.pending()).toBe(0);
  expectPicks(recorded);
});

test("does not pick or call done for a second next, and repicks the first stream after backoff", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let fetches = 0;
  const recorded = track(() => "https://example.com");
  const handle = vi.fn(async () => {
    fetches += 1;
    if (fetches === 1) {
      throw new TypeError("down");
    }
    return sseResponse("data: hi\n\n");
  });
  const pending = orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(recorded.balancer),
      withSSEHandle(handle),
      withSSEReconnect({ attempts: 1, delayMs: 1000, factor: 1 }),
      withInterceptors(
        createSSEInterceptor(async (req, next) => {
          const first = next(req);
          for (
            let attempt = 0;
            recorded.dones.length === 0 && attempt < 50;
            attempt += 1
          ) {
            await Promise.resolve();
          }
          expect(recorded.picks).toHaveLength(1);
          expect(recorded.pending()).toBe(0);
          expect(recorded.dones).toEqual([
            {
              endpoint: "https://example.com",
              info: { attempted: true, code: "NET_UNREACHABLE" },
            },
          ]);
          const second = await next(req);
          await second.closed;
          expect(recorded.picks).toHaveLength(1);
          expect(recorded.dones).toHaveLength(1);
          expect(recorded.pending()).toBe(0);
          await vi.advanceTimersByTimeAsync(1000);
          return await first;
        }),
      ),
    ),
  );
  const [error, stream] = await pending;
  expect(error).toBeNull();
  await stream?.closed;
  expect(recorded.picks).toHaveLength(2);
  expect(fetches).toBe(3);
  expect(recorded.dones).toHaveLength(2);
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);
});

test("calls done once for each sseHandler exit before fetchEventStream", async () => {
  const handle = vi.fn(async () => sseResponse("data: hi\n\n"));
  const urlRecord = track(() => "https://example.com");
  const [urlError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(urlRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          req.endpoint = "https://elsewhere.example/x";
          return next(req);
        }),
      ),
    ),
  );
  expect(urlError?.code).toBe("REQ_BUILD_FAILED");
  expect(urlError?.cause).toBeInstanceOf(RequestUrlError);
  expect(handle).not.toHaveBeenCalled();
  expect(urlRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(urlRecord.pending()).toBe(0);

  const cancel = new AbortController();
  const cancelRecord = track(() => "https://example.com");
  const [cancelError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(cancelRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          cancel.abort(ERR_ABORTED);
          return next(req);
        }),
      ),
    )({ signal: cancel.signal }),
  );
  expect(cancelError?.code).toBe("NET_ABORTED");
  expect(cancelRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(cancelRecord.pending()).toBe(0);

  const deadline = new AbortController();
  const deadlineRecord = track(() => "https://example.com");
  const [deadlineError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(deadlineRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          deadline.abort(ERR_TIMEOUT);
          return next(req);
        }),
      ),
    )({ signal: deadline.signal }),
  );
  expect(deadlineError?.code).toBe("NET_TIMEOUT");
  expect(deadlineRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(deadlineRecord.pending()).toBe(0);

  vi.stubGlobal("fetch", undefined);
  const missing = track(() => "https://example.com");
  const [missingError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(missing.balancer),
    ),
  );
  expect(missingError?.code).toBe("ENV_UNSUPPORTED");
  expect(missing.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(missing.pending()).toBe(0);
  expect(handle).not.toHaveBeenCalled();
  expectPicks(urlRecord);
});

test("calls done once when the base was replaced and the signal is aborted or the url is invalid", async () => {
  const cancel = new AbortController();
  const cancelRecord = track(() => "https://example.com");
  const handle = vi.fn(async () => sseResponse("data: hi\n\n"));
  const [cancelError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(cancelRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          req.baseEndpoint = "https://replaced.example";
          cancel.abort(ERR_ABORTED);
          return next(req);
        }),
      ),
    )({ signal: cancel.signal }),
  );
  expect(cancelError?.code).toBe("NET_ABORTED");
  expect(handle).not.toHaveBeenCalled();
  expect(cancelRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(cancelRecord.pending()).toBe(0);

  const urlRecord = track(() => "https://example.com");
  const [urlError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(urlRecord.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          req.baseEndpoint = "http://[";
          return next(req);
        }),
      ),
    ),
  );
  expect(urlError?.code).toBe("REQ_BUILD_FAILED");
  expect(handle).not.toHaveBeenCalled();
  expect(urlRecord.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(urlRecord.pending()).toBe(0);
  expectPicks(cancelRecord);
});

test("does not call done when the initial pick fails, and calls it once when building throws", async () => {
  const cause = new Error("none");
  const failed = track(() => [cause, undefined]);
  const [error] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(failed.balancer),
    ),
  );
  expect(error?.code).toBe("REQ_BUILD_FAILED");
  expect(error?.cause).toBe(cause);
  expect(failed.dones).toHaveLength(0);
  expect(failed.pending()).toBe(0);

  const built = defineEventStream({
    builder: () => {
      throw new Error("build");
    },
    events: { message: struct.string() },
    input: struct.object({}),
    operation: "orders",
    path: "/events",
  });
  const recorded = track(() => "https://example.com");
  const [buildError] = await built(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(recorded.balancer),
    ),
    {},
  );
  expect(buildError?.code).toBe("REQ_BUILD_FAILED");
  expect(recorded.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);
});

test("keeps EXT_INTERCEPTOR_FAILED when an interceptor throws a REQ_BUILD_FAILED fault", async () => {
  const thrown = createPreflightFault(
    "REQ_BUILD_FAILED",
    new Error("interceptor fault"),
  );
  const recorded = track(() => "https://example.com");
  const [error] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withEndpointBalancer(recorded.balancer),
      withInterceptors(
        createSSEInterceptor(() => {
          throw thrown;
        }),
      ),
    ),
  );
  expect(error?.code).toBe("EXT_INTERCEPTOR_FAILED");
  expect(error?.cause).toBe(thrown);
  expect(recorded.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(recorded.pending()).toBe(0);
});
