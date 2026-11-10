import { afterEach, expect, inject, test, vi } from "vitest";
import type { Balancer, DoneInfo, PickInfo, PickOutcome } from "../balancer";
import { outlierDetection, pickFirstBalancer } from "../balancer";
import {
  createClient,
  withEndpoint,
  withBalancer,
  withInterceptors,
  withSSEHandle,
  withSSEOnInvalidEvent,
  withSSEReconnect,
} from "../client";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { createPreflightFault } from "../error/factory";
import { createSSEInterceptor } from "../interceptor";
import { RequestUrlError } from "../internal/url";
import { struct } from "../struct";
import { defineEventStream } from "./index";
import { fixture } from "../../test/fixture/client-auto";
import type {
  FixtureHeaders,
  LoggedRequest,
  ScenarioName,
  ScenarioParams,
  ScriptStep,
} from "../../test/fixture/types";

const SSE_HEADERS: FixtureHeaders = { "content-type": "text/event-stream" };
const RECONNECT = { attempts: 1, delayMs: 0, factor: 1 };
const EVENT_HOLD: ScriptStep = {
  status: 200,
  headers: SSE_HEADERS,
  chunks: ["data: hi\n\n"],
  then: "hold",
};
const EVENT_END: ScriptStep = {
  status: 200,
  headers: SSE_HEADERS,
  chunks: ["data: hi\n\n"],
  then: "end",
};
const EVENT_DROP: ScriptStep = {
  status: 200,
  headers: SSE_HEADERS,
  chunks: ["data: hi\n\n"],
  then: "drop",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Running {
  url: string;
  requests(): Promise<readonly LoggedRequest[]>;
  seen(count: number): Promise<void>;
}

interface Held extends Running {
  endHeld(): Promise<void>;
  dropHeld(): Promise<void>;
}

async function listen<S extends ScenarioName>(
  scenario: S,
  params: ScenarioParams[S],
): Promise<Held> {
  const client = fixture(inject("testServerHost"), inject("fixtureToken"));
  const url = await client.endpoint("endpoint", scenario, params);
  return {
    url,
    async requests() {
      const logged = await client.log();
      return logged.requests.filter(
        (request) => request.endpoint === "endpoint",
      );
    },
    async seen(count) {
      await client.log({ wait: count });
    },
    endHeld() {
      return client.act("endpoint", "end");
    },
    dropHeld() {
      return client.act("endpoint", "drop");
    },
  };
}

async function listenReset(): Promise<Running> {
  const client = fixture(inject("testServerHost"), inject("fixtureToken"));
  await client.endpoint("anchor", "hang", {});
  return {
    url: client.rawUrl(inject("rawServerOrigin"), "reset-before-headers"),
    async requests() {
      const logged = await client.log();
      return logged.requests.filter(
        (request) => request.endpoint === "raw:reset-before-headers",
      );
    },
    async seen(count) {
      await client.log({ wait: count });
    },
  };
}

interface Recorded {
  balancer: Balancer;
  picks: PickInfo[];
  dones: Array<{ endpoint: string; info: DoneInfo }>;
  ends: Array<{ endpoint: string; info: DoneInfo }>;
  pending(): number;
}

function track(
  choose: (index: number, info: PickInfo) => string | PickOutcome,
): Recorded {
  const picks: PickInfo[] = [];
  const dones: Array<{ endpoint: string; info: DoneInfo }> = [];
  const ends: Array<{ endpoint: string; info: DoneInfo }> = [];
  let pending = 0;
  return {
    picks,
    dones,
    ends,
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
            end(info) {
              ends.push({ endpoint: choice, info });
            },
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
    expect(pick).not.toHaveProperty("transport");
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

function readFailureResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("response stream lost"));
      },
    }),
    { headers: SSE_HEADERS },
  );
}

test("repicks after a read failure when reconnect is on, and does not pick on terminal paths", async () => {
  const primary = await listen("script", { plan: [EVENT_HOLD] });
  const secondary = await listen("script", { plan: [EVENT_END] });
  const recorded = track((index) =>
    index === 1 ? primary.url : secondary.url,
  );
  const client = createClient(
    withEndpoint(primary.url, secondary.url),
    withBalancer(recorded.balancer),
    withSSEReconnect(RECONNECT),
  );
  const [error, stream] = await orders(client);
  expect(error).toBeNull();
  if (!stream) {
    throw new Error("expected a stream");
  }
  await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
    done: false,
    value: { data: "hi" },
  });
  await primary.dropHeld();
  await stream.closed;
  expect(recorded.picks).toHaveLength(2);
  expect(await primary.requests()).toHaveLength(1);
  expect(await secondary.requests()).toHaveLength(1);
  expect(recorded.ends).toEqual([
    { endpoint: primary.url, info: { attempted: true, status: 200 } },
    { endpoint: secondary.url, info: { attempted: true, status: 200 } },
  ]);
  expect(recorded.dones[0]?.info).toEqual({
    attempted: true,
    code: "NET_UNREACHABLE",
  });
  expect(recorded.dones[1]?.info).toEqual({ attempted: true, status: 200 });
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);

  const eof = await listen("script", { plan: [EVENT_END] });
  const eofRecord = track(() => eof.url);
  const eofClient = createClient(
    withEndpoint(eof.url),
    withBalancer(eofRecord.balancer),
    withSSEReconnect(RECONNECT),
  );
  const [eofError, eofStream] = await orders(eofClient);
  expect(eofError).toBeNull();
  await eofStream?.closed;
  expect(eofRecord.picks).toHaveLength(1);
  expect(await eof.requests()).toHaveLength(1);

  const refused = await listen("respond", {
    status: 500,
    headers: SSE_HEADERS,
  });
  const plain = await listen("respond", {
    status: 200,
    contentType: "text/plain",
    body: "nope",
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
        withBalancer(terminal.balancer),
        withSSEReconnect(RECONNECT),
      ),
    );
    expect(terminalError?.code).not.toBeUndefined();
    expect(terminal.picks).toHaveLength(1);
    expect(await server.requests()).toHaveLength(1);
    expect(terminal.pending()).toBe(0);
  }

  const huge = await listen("respond", {
    status: 200,
    headers: SSE_HEADERS,
    body: `data: ${"x".repeat(64)}\n\n`,
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
      withBalancer(hugeRecord.balancer),
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

  const dropped = await listen("script", { plan: [EVENT_DROP] });
  const quiet = track(() => dropped.url);
  const [quietError, quietStream] = await orders(
    createClient(withEndpoint(dropped.url), withBalancer(quiet.balancer)),
  );
  expect(quietError).toBeNull();
  await quietStream?.closed;
  expect(quiet.picks).toHaveLength(1);
  expect(await dropped.requests()).toHaveLength(1);

  const postServer = await listen("script", { plan: [EVENT_DROP] });
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
      withBalancer(postRecord.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(postError).toBeNull();
  await postStream?.closed;
  expect(postRecord.picks).toHaveLength(1);
  expect(await postServer.requests()).toHaveLength(1);

  const allowed = await listen("script", { plan: [EVENT_DROP, EVENT_END] });
  const allowedRecord = track(() => allowed.url);
  const [allowedError, allowedStream] = await post(
    createClient(
      withEndpoint(allowed.url),
      withBalancer(allowedRecord.balancer),
      withSSEReconnect({ ...RECONNECT, shouldReconnect: () => true }),
    ),
  );
  expect(allowedError).toBeNull();
  await allowedStream?.closed;
  expect(allowedRecord.picks).toHaveLength(2);
  expect(await allowed.requests()).toHaveLength(2);

  const held = await listen("hang", {});
  const cancelRecord = track(() => held.url);
  const controller = new AbortController();
  const pending = orders(
    createClient(
      withEndpoint(held.url),
      withBalancer(cancelRecord.balancer),
      withSSEReconnect(RECONNECT),
    )({ signal: controller.signal }),
  );
  await held.seen(1);
  controller.abort(ERR_ABORTED);
  const [cancelError] = await pending;
  expect(cancelError?.code).toBe("NET_ABORTED");
  expect(cancelRecord.picks).toHaveLength(1);
  expect(cancelRecord.dones).toEqual([
    { endpoint: held.url, info: { attempted: false } },
  ]);
  expect(cancelRecord.pending()).toBe(0);
});

test.each([false, true])(
  "default pick-first leaves a read-failed endpoint with reconnect enabled: %s",
  async (reconnect) => {
    const primary = await listen("script", { plan: [EVENT_HOLD] });
    const secondary = await listen("respond", {
      status: 200,
      headers: SSE_HEADERS,
      body: "data: recovered\n\n",
    });
    const client = createClient(
      withEndpoint(primary.url, secondary.url),
      ...(reconnect ? [withSSEReconnect(RECONNECT)] : []),
    );
    const [error, stream, open] = await orders(client);
    expect(error).toBeNull();
    if (!stream) throw new Error("expected a stream");
    try {
      const iterator = stream[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({
        value: { data: "hi" },
      });
      expect(open?.response.status).toBe(200);
      await primary.dropHeld();
      if (reconnect) {
        await expect(iterator.next()).resolves.toMatchObject({
          value: { data: "recovered" },
        });
        expect(await stream.closed).toEqual({ kind: "eof" });
        expect(await secondary.requests()).toHaveLength(1);
      } else {
        expect(await stream.closed).toMatchObject({
          code: "NET_UNREACHABLE",
          kind: "error",
        });
        expect(await secondary.requests()).toHaveLength(0);
      }
      expect(await primary.requests()).toHaveLength(1);
      const [nextError, nextStream] = await orders(client);
      expect(nextError).toBeNull();
      if (!nextStream) throw new Error("expected the next stream");
      try {
        expect(await primary.requests()).toHaveLength(1);
        expect(await nextStream.closed).toEqual({ kind: "eof" });
        expect(await secondary.requests()).toHaveLength(reconnect ? 2 : 1);
      } finally {
        await nextStream[Symbol.asyncDispose]();
      }
    } finally {
      await stream[Symbol.asyncDispose]();
    }
  },
);

test("default health filtering receives read failures and breaks only after five samples", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const primary = "https://primary.example";
  const secondary = "https://secondary.example";
  const recorded = track((_index, info) => info.endpoints[0] ?? "");
  const seen: string[] = [];
  const client = createClient(
    withEndpoint(primary, secondary),
    withBalancer(outlierDetection(recorded.balancer)),
    withSSEHandle((input) => {
      const origin = new URL(new Request(input).url).origin;
      seen.push(origin);
      return Promise.resolve(
        origin === primary
          ? readFailureResponse()
          : sseResponse("data: healthy\n\n"),
      );
    }),
  );
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const [error, stream] = await orders(client);
    expect(error).toBeNull();
    expect(await stream?.closed).toMatchObject({
      kind: attempt < 5 ? "error" : "eof",
    });
  }
  expect(seen).toEqual([
    primary,
    primary,
    primary,
    primary,
    primary,
    secondary,
  ]);
  expect(recorded.dones.map(({ info }) => info)).toEqual([
    ...Array.from({ length: 5 }, () => ({
      attempted: true,
      code: "NET_UNREACHABLE",
    })),
    { attempted: true, status: 200 },
  ]);
  expect(recorded.pending()).toBe(0);
});

test("an endpoint whose stream opens and then fails escalates its penalty", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  const primary = "https://primary.example";
  const secondary = "https://secondary.example";
  const seen: string[] = [];
  const client = createClient(
    withEndpoint(primary, secondary),
    withBalancer(
      outlierDetection(
        { pick: (info) => [null, { endpoint: info.endpoints[0] ?? "" }] },
        { jitterRatio: 0 },
      ),
    ),
    withSSEHandle((input) => {
      const origin = new URL(new Request(input).url).origin;
      seen.push(origin);
      return Promise.resolve(
        origin === primary
          ? readFailureResponse()
          : sseResponse("data: healthy\n\n"),
      );
    }),
  );
  async function connect(): Promise<void> {
    const [error, stream] = await orders(client);
    expect(error).toBeNull();
    await stream?.closed;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) await connect();
  let now = 0;
  for (const penalty of [1000, 2000, 3000]) {
    now += penalty;
    vi.advanceTimersByTime(now - 1 - performance.now());
    seen.length = 0;
    await connect();
    expect(seen).toEqual([secondary]);
    vi.advanceTimersByTime(now - performance.now());
    seen.length = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) await connect();
    expect(seen).toEqual(Array.from({ length: 5 }, () => primary));
  }
});

test("invalid event validation and a throwing observer do not become endpoint failures", async () => {
  const recorded = track(() => "https://example.com");
  const observer = vi.fn(() => {
    throw new TypeError("application observer");
  });
  const events = defineEventStream({
    events: { message: struct.number() },
    path: "/events",
  });
  const [error, stream] = await events(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(recorded.balancer),
      withSSEHandle(() => Promise.resolve(sseResponse("data: not-json\n\n"))),
      withSSEOnInvalidEvent(observer),
    ),
  );
  expect(error).toBeNull();
  expect(await stream?.closed).toEqual({ kind: "eof" });
  expect(observer).toHaveBeenCalledOnce();
  expect(recorded.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: true, status: 200 } },
  ]);
});

test("does not attribute a post-handshake read rejection while offline", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const recorded = track(() => "https://example.com");
  const [error, stream] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(recorded.balancer),
      withSSEHandle(() => Promise.resolve(readFailureResponse())),
    ),
  );
  expect(error).toBeNull();
  expect(await stream?.closed).toMatchObject({
    kind: "error",
    code: "NET_UNREACHABLE",
  });
  expect(recorded.ends).toEqual([
    { endpoint: "https://example.com", info: { attempted: true, status: 200 } },
  ]);
  expect(recorded.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(recorded.pending()).toBe(0);
});

test("keeps read failures on a replaced base and a second next unattributed", async () => {
  const primary = "https://primary.example";
  const replacement = "https://replacement.example";
  const replaced = track(() => primary);
  const seen: string[] = [];
  const [error, stream] = await orders(
    createClient(
      withEndpoint(primary),
      withBalancer(replaced.balancer),
      withSSEReconnect(RECONNECT),
      withSSEHandle((input) => {
        seen.push(new Request(input).url);
        return Promise.resolve(
          seen.length === 1
            ? readFailureResponse()
            : sseResponse("data: recovered\n\n"),
        );
      }),
      withInterceptors(
        createSSEInterceptor((req, next) =>
          next({ ...req, baseEndpoint: replacement }),
        ),
      ),
    ),
  );
  expect(error).toBeNull();
  expect(await stream?.closed).toEqual({ kind: "eof" });
  expect(seen).toEqual([`${replacement}/events`, `${replacement}/events`]);
  expect(replaced.picks).toHaveLength(1);
  expect(replaced.ends).toEqual([]);
  expect(replaced.dones).toEqual([
    { endpoint: primary, info: { attempted: false } },
  ]);

  const extra = track(() => primary);
  let fetches = 0;
  const [extraError, first] = await orders(
    createClient(
      withEndpoint(primary),
      withBalancer(extra.balancer),
      withSSEHandle(() =>
        Promise.resolve(
          ++fetches === 1
            ? sseResponse("data: first\n\n")
            : readFailureResponse(),
        ),
      ),
      withInterceptors(
        createSSEInterceptor(async (req, next) => {
          const owned = await next(req);
          const other = await next(req);
          expect(await other.closed).toMatchObject({
            kind: "error",
            code: "NET_UNREACHABLE",
          });
          return owned;
        }),
      ),
    ),
  );
  expect(extraError).toBeNull();
  expect(await first?.closed).toEqual({ kind: "eof" });
  expect(fetches).toBe(2);
  expect(extra.picks).toHaveLength(1);
  expect(extra.dones).toEqual([
    { endpoint: primary, info: { attempted: true, status: 200 } },
  ]);
  expect(extra.pending()).toBe(0);
});

test("calls done when the connection ends, not when the handshake succeeds", async () => {
  const held = await listen("script", { plan: [EVENT_HOLD] });
  const recorded = track(() => held.url);
  const [error, stream] = await orders(
    createClient(withEndpoint(held.url), withBalancer(recorded.balancer)),
  );
  expect(error).toBeNull();
  if (!stream) {
    throw new Error("expected a stream");
  }
  expect(recorded.dones).toHaveLength(0);
  expect(recorded.pending()).toBe(1);
  await held.endHeld();
  await stream.closed;
  expect(recorded.dones).toEqual([
    { endpoint: held.url, info: { attempted: true, status: 200 } },
  ]);
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);
});

test("reports REQ_BUILD_FAILED when a reconnect pick fails before open", async () => {
  const down = await listenReset();
  const cause = new Error("no endpoint");
  const recorded = track((index) =>
    index === 1 ? down.url : [cause, undefined],
  );
  const [error] = await orders(
    createClient(
      withEndpoint(down.url),
      withBalancer(recorded.balancer),
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

  const broken = pickFirstBalancer({
    // @ts-expect-error shuffle rejects every non-boolean at runtime
    shuffle: 1,
  });
  const options = track((index, info) =>
    index === 1 ? down.url : broken.pick(info),
  );
  const [optionError] = await orders(
    createClient(
      withEndpoint(down.url),
      withBalancer(options.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(optionError?.code).toBe("REQ_OPTIONS_INVALID");
  expect(optionError?.code).not.toBe("NET_UNREACHABLE");
  expect(options.pending()).toBe(0);
  expectPicks(recorded);
});

test("reports REQ_BUILD_FAILED on closed when a reconnect pick fails after open", async () => {
  const dropped = await listen("script", { plan: [EVENT_DROP] });
  const cause = new Error("no endpoint");
  const recorded = track((index) =>
    index === 1 ? dropped.url : [cause, undefined],
  );
  const [error, stream] = await orders(
    createClient(
      withEndpoint(dropped.url),
      withBalancer(recorded.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(error).toBeNull();
  const closed = await stream?.closed;
  expect(closed).toMatchObject({
    code: "REQ_BUILD_FAILED",
    kind: "error",
  });
  if (closed?.kind !== "error") {
    throw new Error("expected the reconnect pick to close as an error");
  }
  expect(closed.cause).toEqual(
    expect.objectContaining({
      cause,
      code: "REQ_BUILD_FAILED",
    }),
  );
  expect(recorded.pending()).toBe(0);

  const broken = pickFirstBalancer({
    // @ts-expect-error shuffle rejects every non-boolean at runtime
    shuffle: 1,
  });
  const options = track((index, info) =>
    index === 1 ? dropped.url : broken.pick(info),
  );
  const [optionError, optionStream] = await orders(
    createClient(
      withEndpoint(dropped.url),
      withBalancer(options.balancer),
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
  const down = await listenReset();
  const bad = "http://[";
  const recorded = track((index) => (index === 1 ? down.url : bad));
  const [error] = await orders(
    createClient(
      withEndpoint(down.url, bad),
      withBalancer(recorded.balancer),
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

  const opened = await listen("script", { plan: [EVENT_DROP] });
  const afterOpen = track((index) => (index === 1 ? opened.url : bad));
  const [openError, stream] = await orders(
    createClient(
      withEndpoint(opened.url, bad),
      withBalancer(afterOpen.balancer),
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
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const beforeTimeout = new AbortController();
  const beforeTimeoutRecord = track(() => "https://example.com");
  const [timeoutBefore] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(beforeTimeoutRecord.balancer),
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
      withBalancer(beforeCancelRecord.balancer),
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
  const timeoutServer = await listen("hang", {});
  const timeoutHeadersRecord = track(() => timeoutServer.url);
  const pendingTimeout = orders(
    createClient(
      withEndpoint(timeoutServer.url),
      withBalancer(timeoutHeadersRecord.balancer),
    )({ signal: timeoutHeaders.signal }),
  );
  await timeoutServer.seen(1);
  timeoutHeaders.abort(ERR_TIMEOUT);
  const [timeoutDuring] = await pendingTimeout;
  expect(timeoutDuring?.code).toBe("NET_TIMEOUT");
  expect(await timeoutServer.requests()).toHaveLength(1);
  expect(timeoutHeadersRecord.dones).toEqual([
    {
      endpoint: timeoutServer.url,
      info: { attempted: true, code: "NET_TIMEOUT" },
    },
  ]);
  expect(timeoutHeadersRecord.pending()).toBe(0);

  const cancelHeaders = new AbortController();
  const cancelServer = await listen("hang", {});
  const cancelHeadersRecord = track(() => cancelServer.url);
  const pendingCancel = orders(
    createClient(
      withEndpoint(cancelServer.url),
      withBalancer(cancelHeadersRecord.balancer),
    )({ signal: cancelHeaders.signal }),
  );
  await cancelServer.seen(1);
  cancelHeaders.abort(ERR_ABORTED);
  const [cancelDuring] = await pendingCancel;
  expect(cancelDuring?.code).toBe("NET_ABORTED");
  expect(cancelHeadersRecord.dones).toEqual([
    { endpoint: cancelServer.url, info: { attempted: false } },
  ]);

  const heldTimeout = await listen("script", { plan: [EVENT_HOLD] });
  const heldTimeoutRecord = track(() => heldTimeout.url);
  const timeoutAfter = new AbortController();
  const [heldTimeoutError, heldTimeoutStream] = await orders(
    createClient(
      withEndpoint(heldTimeout.url),
      withBalancer(heldTimeoutRecord.balancer),
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

  const heldCancel = await listen("script", { plan: [EVENT_HOLD] });
  const heldCancelRecord = track(() => heldCancel.url);
  const [heldCancelError, heldCancelStream] = await orders(
    createClient(
      withEndpoint(heldCancel.url),
      withBalancer(heldCancelRecord.balancer),
    ),
  );
  expect(heldCancelError).toBeNull();
  heldCancelStream?.close();
  await vi.waitFor(
    () => expect(heldCancelRecord.dones).toHaveLength(1),
    10_000,
  );
  expect(heldCancelRecord.dones).toEqual([
    { endpoint: heldCancel.url, info: { attempted: false } },
  ]);
  expect(heldCancelRecord.pending()).toBe(0);

  const thrownTimeout = track(() => "https://example.com");
  const [thrownTimeoutError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(thrownTimeout.balancer),
      withSSEHandle(() => Promise.reject(ERR_TIMEOUT)),
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
      withBalancer(thrownAbort.balancer),
      withSSEHandle(() => Promise.reject(ERR_ABORTED)),
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
      withBalancer(thrownCoded.balancer),
      withSSEHandle(() => Promise.reject(coded)),
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
  const origin = await listen("respond", {
    status: 200,
    headers: SSE_HEADERS,
    body: "data: origin\n\n",
  });
  const replaced = await listen("respond", {
    status: 503,
    headers: SSE_HEADERS,
  });
  const recorded = track(() => origin.url);
  const [error, stream, open] = await orders(
    createClient(
      withEndpoint(origin.url),
      withBalancer(recorded.balancer),
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
  expect(await origin.requests()).toHaveLength(0);
  // An unattributed 503 is retried on the same base, like the refused connection below.
  expect(await replaced.requests()).toHaveLength(RECONNECT.attempts + 1);
  expect(recorded.dones).toEqual([
    { endpoint: origin.url, info: { attempted: false } },
  ]);
  expect(recorded.picks).toHaveLength(1);
  expect(recorded.pending()).toBe(0);

  const dropping = await listenReset();
  const again = track(() => origin.url);
  const [againError, againStream] = await orders(
    createClient(
      withEndpoint(origin.url),
      withBalancer(again.balancer),
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
  expect((await dropping.requests()).length).toBeGreaterThan(1);
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
  const handle = vi.fn(() => {
    fetches += 1;
    if (fetches === 1) {
      return Promise.reject(new TypeError("down"));
    }
    return Promise.resolve(sseResponse("data: hi\n\n"));
  });
  const pending = orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(recorded.balancer),
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
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const urlRecord = track(() => "https://example.com");
  const [urlError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(urlRecord.balancer),
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
      withBalancer(cancelRecord.balancer),
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
      withBalancer(deadlineRecord.balancer),
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
      withBalancer(missing.balancer),
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
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const [cancelError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(cancelRecord.balancer),
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
      withBalancer(urlRecord.balancer),
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
      withBalancer(failed.balancer),
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
      withBalancer(recorded.balancer),
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

test("reports REQ_BUILD_FAILED and calls done once when an interceptor passes a header value Headers rejects", async () => {
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const recorded = track(() => "https://example.com");
  let thrownSynchronously = false;
  const [error, stream] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(recorded.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          // @ts-expect-error -- A plain record is not a Headers; only an untyped interceptor can hand it over.
          req.headers = { "x-name": "\u4e2d" };
          try {
            return next(req);
          } catch (cause) {
            thrownSynchronously = true;
            throw cause;
          }
        }),
      ),
    ),
  );
  expect(thrownSynchronously).toBe(false);
  expect(stream).toBeUndefined();
  expect(error?.code).toBe("REQ_BUILD_FAILED");
  expect(error?.cause).toBeInstanceOf(TypeError);
  expect(handle).not.toHaveBeenCalled();
  expect(recorded.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(recorded.ends).toHaveLength(0);
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);
});

test("calls done once when fetchEventStream fails before its first attempt starts", async () => {
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const recorded = track(() => "https://example.com");
  const [error, stream] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(recorded.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          // The first read is the one next() validates; the transport reads it again after the hand-off.
          const valid = req.headers;
          let reads = 0;
          Object.defineProperty(req, "headers", {
            enumerable: true,
            get() {
              reads += 1;
              return reads === 1 ? valid : { "x-name": "\u4e2d" };
            },
          });
          return next(req);
        }),
      ),
    ),
  );
  expect(stream).toBeUndefined();
  expect(error).not.toBeNull();
  expect(handle).not.toHaveBeenCalled();
  expect(recorded.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(recorded.ends).toHaveLength(0);
  expect(recorded.pending()).toBe(0);
  expectPicks(recorded);

  const replaced = track(() => "https://example.com");
  const [replacedError] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(replaced.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          req.baseEndpoint = "https://replaced.example";
          const valid = req.headers;
          let reads = 0;
          Object.defineProperty(req, "headers", {
            enumerable: true,
            get() {
              reads += 1;
              return reads === 1 ? valid : { "x-name": "\u4e2d" };
            },
          });
          return next(req);
        }),
      ),
    ),
  );
  expect(replacedError).not.toBeNull();
  expect(handle).not.toHaveBeenCalled();
  expect(replaced.dones).toEqual([
    { endpoint: "https://example.com", info: { attempted: false } },
  ]);
  expect(replaced.pending()).toBe(0);
  expectPicks(replaced);
});

test("rejects next() instead of throwing and calls done once when an interceptor passes a signal that is not an AbortSignal", async () => {
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const recorded = track(() => "https://example.com");
  let thrownSynchronously = false;
  const [error] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withBalancer(recorded.balancer),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((req, next) => {
          // @ts-expect-error -- A plain object is not an AbortSignal; only an untyped interceptor can hand it over.
          req.signal = { aborted: false };
          try {
            return next(req);
          } catch (cause) {
            thrownSynchronously = true;
            throw cause;
          }
        }),
      ),
    ),
  );
  expect(thrownSynchronously).toBe(false);
  expect(error?.code).toBe("EXT_INTERCEPTOR_FAILED");
  expect(error?.cause).toBeInstanceOf(TypeError);
  expect(handle).not.toHaveBeenCalled();
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
      withBalancer(recorded.balancer),
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

test.each([502, 503, 504])(
  "retries a %s handshake on a fresh pick at startup and after a drop",
  async (status) => {
    const busy = await listen("respond", { status, body: "busy" });
    const healthy = await listen("respond", {
      status: 200,
      headers: SSE_HEADERS,
      body: "data: recovered\n\n",
    });
    const shouldReconnect = vi.fn((_context: unknown) => true);
    const startup = track((index) => (index === 1 ? busy.url : healthy.url));
    const [error, stream, open] = await orders(
      createClient(
        withEndpoint(busy.url, healthy.url),
        withBalancer(startup.balancer),
        withSSEReconnect({ ...RECONNECT, shouldReconnect }),
      ),
    );
    expect(error).toBeNull();
    if (!stream) throw new Error("expected a stream");
    expect(open?.response.status).toBe(200);
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { data: "recovered" },
    });
    expect(await stream.closed).toEqual({ kind: "eof" });
    expect(startup.dones).toEqual([
      {
        endpoint: busy.url,
        info: { attempted: true, code: "NET_UNAVAILABLE", status },
      },
      { endpoint: healthy.url, info: { attempted: true, status: 200 } },
    ]);
    expect(shouldReconnect).toHaveBeenCalledOnce();
    expect(shouldReconnect.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      cause: { code: "HTTP_STATUS", status },
      open: { response: { status } },
    });
    expect(await busy.requests()).toHaveLength(1);
    expect(await healthy.requests()).toHaveLength(1);

    const primary = await listen("script", { plan: [EVENT_HOLD] });
    const reconnecting = track((index) =>
      index === 1 ? primary.url : index === 2 ? busy.url : healthy.url,
    );
    const [openError, opened] = await orders(
      createClient(
        withEndpoint(primary.url, busy.url, healthy.url),
        withBalancer(reconnecting.balancer),
        withSSEReconnect({ ...RECONNECT, attempts: 2 }),
      ),
    );
    expect(openError).toBeNull();
    if (!opened) throw new Error("expected a stream");
    const iterator = opened[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: "hi" },
    });
    await primary.dropHeld();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: "recovered" },
    });
    expect(await opened.closed).toEqual({ kind: "eof" });
    expect(opened.open.response.status).toBe(200);
    expect(reconnecting.dones).toEqual([
      {
        endpoint: primary.url,
        info: { attempted: true, code: "NET_UNREACHABLE" },
      },
      {
        endpoint: busy.url,
        info: { attempted: true, code: "NET_UNAVAILABLE", status },
      },
      { endpoint: healthy.url, info: { attempted: true, status: 200 } },
    ]);
    expect(await busy.requests()).toHaveLength(2);
    expect(await healthy.requests()).toHaveLength(2);
    expect(reconnecting.pending()).toBe(0);
    expectPicks(reconnecting);
  },
);

test("default pick-first moves past a 503 reconnect handshake back to the recovered endpoint", async () => {
  const flaky = await listen("script", {
    plan: [
      EVENT_HOLD,
      {
        status: 200,
        headers: SSE_HEADERS,
        chunks: ["data: again\n\n"],
        then: "end",
      },
    ],
  });
  const busy = await listen("respond", { status: 503, body: "busy" });
  const [error, stream] = await orders(
    createClient(
      withEndpoint(flaky.url, busy.url),
      withSSEReconnect({ ...RECONNECT, attempts: 3 }),
    ),
  );
  expect(error).toBeNull();
  if (!stream) throw new Error("expected a stream");
  const iterator = stream[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toMatchObject({
    value: { data: "hi" },
  });
  await flaky.dropHeld();
  await expect(iterator.next()).resolves.toMatchObject({
    value: { data: "again" },
  });
  expect(await stream.closed).toEqual({ kind: "eof" });
  expect(await flaky.requests()).toHaveLength(2);
  expect(await busy.requests()).toHaveLength(1);
});

test.each([400, 401, 404])(
  "keeps a %s handshake fatal at startup and after a drop with reconnect enabled",
  async (status) => {
    const rejecting = await listen("respond", { status, body: "no" });
    const shouldReconnect = vi.fn(() => true);
    const startup = track(() => rejecting.url);
    const [error, stream, open] = await orders(
      createClient(
        withEndpoint(rejecting.url),
        withBalancer(startup.balancer),
        withSSEReconnect({ ...RECONNECT, shouldReconnect }),
      ),
    );
    expect(stream).toBeUndefined();
    expect(error).toMatchObject({ code: "HTTP_STATUS", status });
    expect(open?.response.status).toBe(status);
    expect(await rejecting.requests()).toHaveLength(1);
    expect(startup.picks).toHaveLength(1);
    expect(startup.dones).toEqual([
      { endpoint: rejecting.url, info: { attempted: true, status } },
    ]);
    expect(shouldReconnect).not.toHaveBeenCalled();

    const primary = await listen("script", { plan: [EVENT_HOLD] });
    const reconnecting = track((index) =>
      index === 1 ? primary.url : rejecting.url,
    );
    const [openError, opened] = await orders(
      createClient(
        withEndpoint(primary.url, rejecting.url),
        withBalancer(reconnecting.balancer),
        withSSEReconnect({ ...RECONNECT, shouldReconnect }),
      ),
    );
    expect(openError).toBeNull();
    if (!opened) throw new Error("expected a stream");
    const iterator = opened[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: "hi" },
    });
    await primary.dropHeld();
    const failure = await iterator.next().catch((cause: unknown) => cause);
    const closed = await opened.closed;
    expect(closed).toMatchObject({
      cause: { code: "HTTP_STATUS", status },
      code: "HTTP_STATUS",
      kind: "error",
    });
    if (closed.kind !== "error") throw new Error("expected an error close");
    expect(failure).toBe(closed.cause);
    expect(opened.open.response.status).toBe(status);
    expect(shouldReconnect).toHaveBeenCalledOnce();
    expect(reconnecting.picks).toHaveLength(2);
    expect(await rejecting.requests()).toHaveLength(2);
    expect(reconnecting.pending()).toBe(0);
  },
);

test("ends exhausted 503 retries with the HTTP_STATUS fault of a failed first handshake", async () => {
  const busy = await listen("respond", { status: 503, body: "busy" });
  const [plain, , plainOpen] = await orders(
    createClient(withEndpoint(busy.url)),
  );
  const [exhausted, stream, open] = await orders(
    createClient(withEndpoint(busy.url), withSSEReconnect(RECONNECT)),
  );
  expect(stream).toBeUndefined();
  expect(await busy.requests()).toHaveLength(1 + RECONNECT.attempts + 1);
  expect(plain).toMatchObject({ code: "HTTP_STATUS", status: 503 });
  expect(exhausted).toMatchObject({ code: "HTTP_STATUS", status: 503 });
  expect(exhausted?.message).toBe(plain?.message);
  expect(plainOpen?.response.status).toBe(503);
  expect(open?.response.status).toBe(503);

  const primary = await listen("script", { plan: [EVENT_HOLD] });
  const reconnecting = track((index) => (index === 1 ? primary.url : busy.url));
  const [openError, opened] = await orders(
    createClient(
      withEndpoint(primary.url, busy.url),
      withBalancer(reconnecting.balancer),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(openError).toBeNull();
  if (!opened) throw new Error("expected a stream");
  const iterator = opened[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toMatchObject({
    value: { data: "hi" },
  });
  await primary.dropHeld();
  const failure = await iterator.next().catch((cause: unknown) => cause);
  const closed = await opened.closed;
  expect(closed).toMatchObject({
    cause: { code: "HTTP_STATUS", message: plain?.message, status: 503 },
    code: "HTTP_STATUS",
    kind: "error",
    reason: plain?.message,
  });
  if (closed.kind !== "error") throw new Error("expected an error close");
  expect(failure).toBe(closed.cause);
  expect(opened.open.response.status).toBe(503);
  expect(reconnecting.dones).toEqual([
    {
      endpoint: primary.url,
      info: { attempted: true, code: "NET_UNREACHABLE" },
    },
    {
      endpoint: busy.url,
      info: { attempted: true, code: "NET_UNAVAILABLE", status: 503 },
    },
  ]);
  expect(reconnecting.pending()).toBe(0);
});

test("reports only the last startup attempt after a retried 503", async () => {
  let calls = 0;
  const [error, stream, open] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(() => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(new Response("busy", { status: 503 }))
          : Promise.reject(new TypeError("connection refused"));
      }),
      withSSEReconnect(RECONNECT),
    ),
  );
  expect(stream).toBeUndefined();
  expect(error?.code).toBe("NET_UNREACHABLE");
  expect(open).toBeUndefined();
  expect(calls).toBe(2);
});

test("applies the reconnect gates to a 503 handshake", async () => {
  const busy = vi.fn(() =>
    Promise.resolve(new Response("busy", { status: 503 })),
  );
  const post = defineEventStream({
    events: { message: struct.string() },
    method: "POST",
    operation: "orders",
    path: "/events",
  });
  for (const [definition, reconnect] of [
    [post, RECONNECT],
    [orders, { ...RECONNECT, shouldReconnect: () => false }],
    [orders, { ...RECONNECT, attempts: 0 }],
  ] as const) {
    busy.mockClear();
    const [error] = await definition(
      createClient(
        withEndpoint("https://example.com"),
        withSSEHandle(busy),
        withSSEReconnect(reconnect),
      ),
    );
    expect(error).toMatchObject({ code: "HTTP_STATUS", status: 503 });
    expect(busy).toHaveBeenCalledOnce();
  }
});
