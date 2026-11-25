import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withCredentials,
  withEndpoint,
  withHeaders,
  withRetry,
  withWebSocketProtocols,
} from "../index";
import {
  beforeEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { fixture } from "../../test/fixture/client-auto.ts";
import {
  attachPortHost,
  createPortHTTPHandle,
  createPortSSEHandle,
  createPortWebSocketHandle,
  withPortTransport,
  type PortDisconnectListener,
  type PortEndpoint,
  type PortMessageListener,
  type PortWireMode,
} from "./index";

interface MemoryPortPair {
  readonly client: PortEndpoint;
  readonly host: PortEndpoint;
  readonly toClientRaw: (msg: unknown) => void;
  readonly toHostRaw: (msg: unknown) => void;
  readonly disconnect: () => void;
}

function createMemoryPortPair(mode?: PortWireMode): MemoryPortPair {
  const clientMsg = new Set<PortMessageListener>();
  const clientDisc = new Set<PortDisconnectListener>();
  const hostMsg = new Set<PortMessageListener>();
  const hostDisc = new Set<PortDisconnectListener>();

  const deliver = (listeners: Set<PortMessageListener>, msg: unknown): void => {
    for (const listener of [...listeners]) {
      listener(msg);
    }
  };

  return {
    client: {
      mode,
      postMessage(msg) {
        deliver(hostMsg, msg);
      },
      onMessage(listener) {
        clientMsg.add(listener);
        return () => clientMsg.delete(listener);
      },
      onDisconnect(listener) {
        clientDisc.add(listener);
        return () => clientDisc.delete(listener);
      },
    },
    host: {
      mode,
      postMessage(msg) {
        deliver(clientMsg, msg);
      },
      onMessage(listener) {
        hostMsg.add(listener);
        return () => hostMsg.delete(listener);
      },
      onDisconnect(listener) {
        hostDisc.add(listener);
        return () => hostDisc.delete(listener);
      },
    },
    toClientRaw(msg) {
      deliver(clientMsg, msg);
    },
    toHostRaw(msg) {
      deliver(hostMsg, msg);
    },
    disconnect() {
      for (const listener of [...clientDisc]) {
        listener();
      }
      for (const listener of [...hostDisc]) {
        listener();
      }
    },
  };
}

const stringRejection: unknown = "String policy rejection";
const fetchStringRejection: unknown = "fetch-string-failure";
const connectStringRejection: unknown = "connect-string-fail";
const ctorStringRejection: unknown = "ctor-string-error";

function throwUnknown(value: unknown): never {
  throw value;
}

function openMessageChannel(): MessageChannel {
  const channel = new MessageChannel();
  onTestFinished(() => {
    channel.port1.close();
    channel.port2.close();
  });
  return channel;
}

describe("@defjs/core/port", () => {
  let baseUrl: string;
  let token: string;

  beforeEach(() => {
    baseUrl = inject("testServerHost");
    token = inject("fixtureToken");
  });

  test("routes HTTP, SSE, and WebSocket over a shared MessageChannel in structured mode", async () => {
    const channel = openMessageChannel();
    const host = attachPortHost(channel.port2, {
      allowedOrigins: [baseUrl],
    });
    onTestFinished(() => host.close());

    const f = fixture(baseUrl, token);
    const wsUrl = await f.endpoint("ws-msg", "ws", {
      send: [JSON.stringify("greeting"), { binary: JSON.stringify("bin-hi") }],
      end: {
        send: [JSON.stringify("farewell")],
        code: 1000,
        reason: "complete",
      },
    });

    const client = createClient(
      withEndpoint(baseUrl),
      withHeaders({ "x-client-header": "port-test" }),
      withPortTransport(channel.port1),
      withWebSocketProtocols(["chat.v1"]),
    );

    const postEcho = defineRequest({
      method: "POST",
      path: "/e2e/echo/:slug",
      input: struct.object({
        slug: struct.string(),
        payload: struct.object({ name: struct.string() }),
      }),
      builder: ({ slug, payload }) => ({
        path: { slug },
        body: payload,
      }),
      output: struct.object({
        bodyText: struct.string(),
        headers: struct.record(struct.string()),
        method: struct.string(),
        path: struct.string(),
      }),
    });

    const [httpErr, httpRes, httpMeta] = await postEcho(client, {
      slug: "items",
      payload: { name: "widget" },
    });
    expect(httpErr).toBeNull();
    expect(httpMeta?.status).toBe(200);
    expect(httpMeta?.url).toBe(`${baseUrl}/e2e/echo/items`);
    expect(httpRes?.method).toBe("POST");
    expect(httpRes?.bodyText).toBe('{"name":"widget"}');
    expect(httpRes?.headers["x-client-header"]).toBe("port-test");

    const getNoContent = defineRequest({
      method: "GET",
      path: "/body/no-content",
    });
    const [ncErr, , ncMeta] = await getNoContent(client);
    expect(ncErr).toBeNull();
    expect(ncMeta?.status).toBe(204);

    const headEmpty = defineRequest({
      method: "HEAD",
      path: "/e2e/in/text",
    });
    const [headErr, , headMeta] = await headEmpty(client);
    expect(headErr).toBeNull();
    expect(headMeta?.status).toBe(200);

    const sseOp = defineEventStream({
      method: "POST",
      path: "/e2e/sse/:room",
      input: struct.object({ room: struct.string(), note: struct.string() }),
      builder: ({ room, note }) => ({
        path: { room },
        headers: { "x-trace-id": "trace-42" },
        body: note,
      }),
      events: {
        note: struct.string(),
        meta: struct.object({
          body: struct.string(),
          room: struct.string(),
          trace_id: struct.string(),
        }),
      },
    });

    const [sseErr, stream, openInfo] = await sseOp(client, {
      room: "lobby",
      note: "hello-sse",
    });
    expect(sseErr).toBeNull();
    expect(openInfo?.url).toBe(`${baseUrl}/e2e/sse/lobby`);
    if (stream === undefined) {
      throw new Error("Expected SSE stream");
    }
    const events: unknown[] = [];
    for await (const ev of stream) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: "note", id: "1", data: "plain-from-server" },
      {
        event: "meta",
        id: "2",
        data: { body: "hello-sse", room: "lobby", trace_id: "trace-42" },
      },
    ]);

    const wsOp = defineWebSocket({
      path: `${new URL(wsUrl).pathname}/socket`,
      incoming: struct.string(),
      outgoing: struct.string(),
    });
    const [wsErr, session] = await wsOp(client);
    expect(wsErr).toBeNull();
    if (session === undefined) {
      throw new Error("Expected WebSocket session");
    }
    session.send("client-ping");
    const wsFrames: string[] = [];
    for await (const frame of session.receive) {
      wsFrames.push(frame);
      if (wsFrames.length === 2) {
        await f.act("ws-msg", "end");
      }
    }
    await session.closed;
    expect(wsFrames).toEqual(["greeting", "bin-hi", "farewell"]);

    const log = await f.log();
    expect(log.requests[0]?.headers["sec-websocket-protocol"]).toBe("chat.v1");
  });

  test("shares one PortMux when individual handles are attached separately", async () => {
    const channel = openMessageChannel();
    let seenOpenFrames = 0;
    const wrappedPort: PortEndpoint = {
      postMessage(msg, transfer) {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "kind" in msg &&
          msg.kind === "http.open"
        ) {
          seenOpenFrames += 1;
        }
        channel.port1.postMessage(msg, transfer ?? []);
      },
      onMessage(listener) {
        const handler = (ev: MessageEvent): void => listener(ev.data);
        channel.port1.addEventListener("message", handler);
        channel.port1.start();
        return () => channel.port1.removeEventListener("message", handler);
      },
    };
    using _host = attachPortHost(channel.port2, {
      allowedOrigins: [baseUrl],
    });

    const httpFetch = createPortHTTPHandle(wrappedPort);
    const sseFetch = createPortSSEHandle(wrappedPort);
    const WsCtor = createPortWebSocketHandle(wrappedPort);

    const r1 = await httpFetch(`${baseUrl}/e2e/in/text`);
    const r2 = await sseFetch(`${baseUrl}/e2e/in/text`);
    expect(await r1.text()).toBe("hello-text");
    expect(await r2.text()).toBe("hello-text");
    expect(seenOpenFrames).toBe(2);
    expect(WsCtor.OPEN).toBe(1);
  });

  test("chunks large binary uploads and downloads with credit backpressure in json mode (>32 KiB Base64 slice)", async () => {
    const channel = openMessageChannel();
    const pullCounts: number[] = [];
    const origPostMessage = channel.port1.postMessage.bind(channel.port1);
    const spyingPort: PortEndpoint = {
      mode: "json",
      postMessage(msg) {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "kind" in msg &&
          msg.kind === "http.pull" &&
          "credits" in msg &&
          typeof msg.credits === "number"
        ) {
          pullCounts.push(msg.credits);
        }
        origPostMessage(msg);
      },
      onMessage(listener) {
        const handler = (ev: MessageEvent): void => listener(ev.data);
        channel.port1.addEventListener("message", handler);
        channel.port1.start();
        return () => channel.port1.removeEventListener("message", handler);
      },
    };

    const host = attachPortHost(channel.port2, {
      allowedOrigins: [baseUrl],
      mode: "json",
      chunkSize: 40_000,
    });
    onTestFinished(() => host.close());

    const payload = new Uint8Array(70_000);
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = i % 251;
    }

    const client = createClient(
      withEndpoint(baseUrl),
      withPortTransport(spyingPort, {
        mode: "json",
        chunkSize: 16_384,
        creditWindow: 2,
      }),
    );

    const uploadRaw = defineRequest({
      method: "POST",
      path: "/e2e/echo-raw",
      input: struct.arrayBuffer(),
      builder: (body) => ({ body }),
      output: struct.object({
        bodyBase64: struct.string(),
      }),
    });

    const [upErr, upRes] = await uploadRaw(client, payload.buffer);
    expect(upErr).toBeNull();
    expect(upRes?.bodyBase64.length).toBeGreaterThan(90_000);

    // Download /body/large with small chunkSize (2000) & creditWindow (2) to force multiple http.pull wait cycles.
    const smallHost = attachPortHost(openMessageChannel().port2, {
      allowAnyOrigin: true,
      chunkSize: 2000,
    });
    smallHost.close();

    const bpChannel = openMessageChannel();
    const bpClientPulls: number[] = [];
    const bpClientEndpoint: PortEndpoint = {
      mode: "json",
      postMessage(msg) {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "kind" in msg &&
          msg.kind === "http.pull" &&
          "credits" in msg &&
          typeof msg.credits === "number"
        ) {
          bpClientPulls.push(msg.credits);
        }
        bpChannel.port1.postMessage(msg);
      },
      onMessage(listener) {
        const handler = (ev: MessageEvent): void => listener(ev.data);
        bpChannel.port1.addEventListener("message", handler);
        bpChannel.port1.start();
        return () => bpChannel.port1.removeEventListener("message", handler);
      },
    };
    const bpHost = attachPortHost(bpChannel.port2, {
      allowedOrigins: [baseUrl],
      mode: "json",
      chunkSize: 2000,
    });
    onTestFinished(() => bpHost.close());

    const bpFetch = createPortHTTPHandle(bpClientEndpoint, {
      mode: "json",
      chunkSize: 2000,
      creditWindow: 2,
    });
    const largeRes = await bpFetch(`${baseUrl}/body/large`, {
      credentials: "same-origin",
    });
    const largeText = await largeRes.text();
    expect(largeText.startsWith('[{"id":0,')).toBe(true);
    expect(bpClientPulls.length).toBeGreaterThan(2);
  });

  test("enforces host default-deny SSRF policies and request validation", async () => {
    const pair = createMemoryPortPair();

    expect(() => attachPortHost(pair.host, {})).toThrow(RangeError);
    expect(() => attachPortHost(pair.host, { allowedOrigins: [] })).toThrow(
      RangeError,
    );
    expect(() =>
      attachPortHost(pair.host, { allowedOrigins: ["not-a-url"] }),
    ).toThrow(RangeError);
    expect(() =>
      attachPortHost(pair.host, { allowedOrigins: ["ftp://example.com"] }),
    ).toThrow(RangeError);
    expect(() =>
      attachPortHost(pair.host, {
        allowedOrigins: ["https://user:pass@example.com"],
      }),
    ).toThrow(RangeError);
    expect(() =>
      attachPortHost(pair.host, { allowAnyOrigin: true, chunkSize: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      attachPortHost(pair.host, {
        allowAnyOrigin: true,
        chunkSize: 1_048_577,
      }),
    ).toThrow(RangeError);
    expect(() =>
      attachPortHost(pair.host, {
        allowAnyOrigin: true,
        maxRequestBodyBytes: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createPortHTTPHandle(pair.client, { creditWindow: 0 }),
    ).toThrow(RangeError);

    const anyHost = attachPortHost(pair.host, {
      allowAnyOrigin: true,
    });
    const anyFetch = createPortHTTPHandle(pair.client);
    const credErr = new Promise<unknown>((resolve) => {
      const unsub = pair.client.onMessage((msg) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "id" in msg &&
          msg.id === 887
        ) {
          unsub();
          resolve(msg);
        }
      });
    });
    pair.toHostRaw({
      v: 1,
      id: 887,
      kind: "http.open",
      url: "http://user:secret@127.0.0.1:8080/a",
      method: "GET",
      headers: [],
      hasBody: false,
      credits: 1,
    });
    await expect(credErr).resolves.toMatchObject({
      kind: "http.error",
      message: "URLs with credentials are not allowed",
    });
    await expect(anyFetch("ftp://example.com/file")).rejects.toThrow(
      'Disallowed URL scheme "ftp:" for http',
    );
    anyHost.close();
    anyHost.close();

    const originHost = attachPortHost(pair.host, {
      allowedOrigins: [baseUrl, "https://127.0.0.1:1", "wss://rt.example.com"],
      allowRequest(context) {
        if (context.url.pathname === "/deny-bool") {
          return false;
        }
        if (context.url.pathname === "/deny-err") {
          throw new Error("Blocked by custom rule");
        }
        if (context.url.pathname === "/deny-str") {
          throwUnknown(stringRejection);
        }
        if (context.url.pathname === "/deny-empty") {
          throw new Error("");
        }
        return true;
      },
    });
    onTestFinished(() => originHost.close());

    const originFetch = createPortHTTPHandle(pair.client);
    await expect(originFetch("https://blocked.example.com/x")).rejects.toThrow(
      'Origin "https://blocked.example.com" is not allowed',
    );
    await expect(originFetch("https://rt.example.com/path")).rejects.toThrow(
      'Origin "https://rt.example.com" is not allowed',
    );
    await expect(originFetch(`${baseUrl}/deny-bool`)).rejects.toThrow(
      "Request denied by policy",
    );
    await expect(originFetch(`${baseUrl}/deny-err`)).rejects.toThrow(
      "Blocked by custom rule",
    );
    await expect(originFetch(`${baseUrl}/deny-str`)).rejects.toThrow(
      "String policy rejection",
    );
    await expect(originFetch(`${baseUrl}/deny-empty`)).rejects.toThrow(
      "Request denied by policy",
    );

    // Invalid raw URL rejected cleanly by policy.
    const invalidUrlOutcome = new Promise<unknown>((resolve) => {
      const unsub = pair.client.onMessage((msg) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "id" in msg &&
          msg.id === 888
        ) {
          unsub();
          resolve(msg);
        }
      });
    });
    pair.toHostRaw({
      v: 1,
      id: 888,
      kind: "http.open",
      url: "not a valid url",
      method: "GET",
      headers: [],
      hasBody: false,
      credits: 1,
    });
    await expect(invalidUrlOutcome).resolves.toMatchObject({
      kind: "http.error",
      message: "Invalid target URL",
    });

    // Origin matching allows wss: when https: origin is allowlisted, and permits https: -> loopback.
    const PolicyWs = createPortWebSocketHandle(pair.client);
    const allowedWss = new PolicyWs("wss://127.0.0.1:1/ws");
    allowedWss.close(1000, "cancel");

    const allowedHttps = await originFetch(
      new Request("https://127.0.0.1:1/ok"),
    ).catch((err: unknown) => err);
    expect(allowedHttps).toBeInstanceOf(Error);

    // Covers empty POST & Firefox Request.body === undefined arrayBuffer fallback across all runtimes.
    const emptyPostRes = await originFetch(`${baseUrl}/e2e/echo`, {
      method: "POST",
    });
    const emptyJson: unknown = await emptyPostRes.json();
    expect(emptyJson).toMatchObject({ bodyText: "" });

    const fallbackEmptyReq = new Request(`${baseUrl}/e2e/echo`, {
      method: "POST",
    });
    Object.defineProperty(fallbackEmptyReq, "body", { value: undefined });
    const fallbackEmptyRes = await originFetch(fallbackEmptyReq);
    const fallbackEmptyJson: unknown = await fallbackEmptyRes.json();
    expect(fallbackEmptyJson).toMatchObject({ bodyText: "" });

    const fallbackReq = new Request(`${baseUrl}/e2e/echo`, {
      method: "POST",
      body: "firefox-fallback",
    });
    Object.defineProperty(fallbackReq, "body", { value: undefined });
    const fallbackRes = await originFetch(fallbackReq);
    const fallbackJson: unknown = await fallbackRes.json();
    expect(fallbackJson).toMatchObject({ bodyText: "firefox-fallback" });

    // Completing ReadableStream body covers pumpRequestBody completion across all runtimes (including Firefox).
    const streamOkReq = new Request(`${baseUrl}/e2e/echo`, { method: "POST" });
    Object.defineProperty(streamOkReq, "body", {
      value: new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode("stream-ok"));
          ctrl.close();
        },
      }),
    });
    const streamOkRes = await originFetch(streamOkReq);
    const streamOkJson: unknown = await streamOkRes.json();
    expect(streamOkJson).toMatchObject({ bodyText: "stream-ok" });
  });

  test("handles cancellation, abort while blocked on backpressure/body, maxRequestBodyBytes, and host teardown", async () => {
    const channel = openMessageChannel();
    const host = attachPortHost(channel.port2, {
      allowedOrigins: [baseUrl],
      chunkSize: 500,
      maxRequestBodyBytes: 10,
    });
    onTestFinished(() => host.close());

    const fetchFn = createPortHTTPHandle(channel.port1, {
      chunkSize: 4,
      creditWindow: 1,
    });

    // 1. Pre-aborted signal rejects immediately.
    const preAc = new AbortController();
    preAc.abort(new Error("already-aborted"));
    await expect(
      fetchFn(`${baseUrl}/e2e/in/text`, { signal: preAc.signal }),
    ).rejects.toThrow("already-aborted");

    // 2. Exceeding host maxRequestBodyBytes fails cleanly.
    await expect(
      fetchFn(`${baseUrl}/e2e/echo-raw`, {
        method: "POST",
        body: "0123456789ABCDEF",
      }),
    ).rejects.toThrow("maxRequestBodyBytes");

    // 3. Aborting hung request while waiting for headers.
    const f = fixture(baseUrl, token);
    const hangUrl = await f.endpoint("hang", "hang", {});
    const hangAc = new AbortController();
    const hangPromise = fetchFn(`${hangUrl}/wait`, { signal: hangAc.signal });
    await vi.waitFor(async () => {
      const log = await f.log();
      expect(log.requests.length).toBeGreaterThanOrEqual(1);
    });
    hangAc.abort(new Error("hang-aborted"));
    await expect(hangPromise).rejects.toThrow("hang-aborted");

    // 4. Aborting/cancelling response stream while blocked on creditWindow = 1.
    const largeRes = await fetchFn(`${baseUrl}/body/large`);
    const reader = largeRes.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel(new Error("stop-early"));

    // 5. Signal abort while reading /body/stall.
    const stallKey = crypto.randomUUID();
    const stallAc = new AbortController();
    const stallRes = await fetchFn(`${baseUrl}/body/stall?key=${stallKey}`, {
      signal: stallAc.signal,
    });
    const stallReader = stallRes.body?.getReader();
    await stallReader?.read();
    stallAc.abort(new Error("stall-aborted"));
    await expect(stallReader?.read()).rejects.toThrow("stall-aborted");

    // 6. Abort during async allowRequest check on host.
    const slowPair = createMemoryPortPair();
    const gate = Promise.withResolvers<boolean>();
    const slowHost = attachPortHost(slowPair.host, {
      allowAnyOrigin: true,
      allowRequest: () => gate.promise,
    });
    onTestFinished(() => slowHost.close());
    const slowFetch = createPortHTTPHandle(slowPair.client);
    const slowAc = new AbortController();
    const slowReq = slowFetch(`${baseUrl}/e2e/in/text`, {
      signal: slowAc.signal,
    });
    slowAc.abort(new Error("aborted-in-policy"));
    gate.resolve(true);
    await expect(slowReq).rejects.toThrow("aborted-in-policy");
  });

  test("handles missing runtime fetch/WebSocket, custom host errors, stream cancel, and upload errors", async () => {
    const pair = createMemoryPortPair();
    const savedFetch = globalThis.fetch;
    const savedWs = globalThis.WebSocket;

    // Upload ReadableStream that yields empty chunk, non-empty chunk, and then throws.
    let readStep = 0;
    const flakyStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        readStep += 1;
        if (readStep === 1) {
          controller.enqueue(new Uint8Array(0));
          return;
        }
        if (readStep === 2) {
          controller.enqueue(new Uint8Array([1, 2]));
          return;
        }
        controller.error(new Error("upload-source-boom"));
      },
    });

    const host = attachPortHost(pair.host, {
      allowAnyOrigin: true,
      fetch: (_url, _init) => Promise.reject(fetchStringRejection),
    });
    const fetchFn = createPortHTTPHandle(pair.client, { chunkSize: 1 });
    await expect(fetchFn(`${baseUrl}/anything`)).rejects.toThrow(
      "fetch-string-failure",
    );

    const streamPair = createMemoryPortPair();
    let fetchResolvedOnAborted: boolean | undefined;
    const streamHost = attachPortHost(streamPair.host, {
      allowAnyOrigin: true,
      fetch: (_url, init) => {
        if (init?.body instanceof Uint8Array) {
          fetchResolvedOnAborted = init.signal?.aborted;
        }
        return Promise.resolve(new Response("hello"));
      },
    });
    const streamFetch = createPortHTTPHandle(streamPair.client);
    const uploadAc = new AbortController();
    const flakyReq = new Request(`${baseUrl}/upload`, {
      method: "POST",
      signal: uploadAc.signal,
    });
    Object.defineProperty(flakyReq, "body", { value: flakyStream });
    await expect(streamFetch(flakyReq)).rejects.toThrow("upload-source-boom");
    expect(fetchResolvedOnAborted).toBeUndefined();
    streamHost.close();
    host.close();

    // Missing global fetch & global WebSocket branches.
    const noGlobalPair = createMemoryPortPair();
    const noGlobalHost = attachPortHost(noGlobalPair.host, {
      allowAnyOrigin: true,
    });
    const noGlobalFetch = createPortHTTPHandle(noGlobalPair.client);
    const NoGlobalWs = createPortWebSocketHandle(noGlobalPair.client);
    try {
      // @ts-expect-error simulating runtime without global fetch
      globalThis.fetch = undefined;
      await expect(noGlobalFetch(`${baseUrl}/e2e/in/text`)).rejects.toThrow(
        "fetch is not supported in current runtime",
      );

      // @ts-expect-error simulating runtime without global WebSocket
      globalThis.WebSocket = undefined;
      const ws = new NoGlobalWs(`ws://127.0.0.1:1/ws`);
      const closed = await new Promise<CloseEvent>((resolve) => {
        ws.addEventListener("close", (ev) => {
          if (ev instanceof CloseEvent) resolve(ev);
        });
      });
      expect(closed.code).toBe(1006);
      expect(closed.reason).toBe(
        "WebSocket is not supported in current runtime",
      );
    } finally {
      globalThis.fetch = savedFetch;
      globalThis.WebSocket = savedWs;
      noGlobalHost.close();
    }

    // Response arriving after channel already aborted on host.
    const latePair = createMemoryPortPair();
    const lateFetchStarted = Promise.withResolvers<void>();
    const lateFetchGate = Promise.withResolvers<Response>();
    const lateBodyCancelled = Promise.withResolvers<void>();
    const lateHost = attachPortHost(latePair.host, {
      allowAnyOrigin: true,
      fetch: () => {
        lateFetchStarted.resolve();
        return lateFetchGate.promise;
      },
    });
    const lateFetch = createPortHTTPHandle(latePair.client);
    const lateAc = new AbortController();
    const lateReq = lateFetch(`${baseUrl}/late`, { signal: lateAc.signal });
    await lateFetchStarted.promise;
    lateAc.abort(new Error("too-late"));
    lateFetchGate.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            lateBodyCancelled.resolve();
          },
        }),
      ),
    );
    await expect(lateReq).rejects.toThrow("too-late");
    await lateBodyCancelled.promise;
    lateHost.close();

    // Host upstream body error mid-stream.
    const errStreamPair = createMemoryPortPair();
    const errStreamHost = attachPortHost(errStreamPair.host, {
      allowAnyOrigin: true,
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(new TextEncoder().encode("part1"));
              },
              pull() {
                throw new TypeError("upstream-stream-broke");
              },
            }),
          ),
        ),
    });
    const errStreamFetch = createPortHTTPHandle(errStreamPair.client);
    const errRes = await errStreamFetch(`${baseUrl}/stream-fail`);
    const errReader = errRes.body?.getReader();
    await errReader?.read();
    await expect(errReader?.read()).rejects.toThrow("upstream-stream-broke");
    errStreamHost.close();

    // Missing HTTP ensureConnected / postMessage throwing on http.open / disconnect during stream.
    const brokenClient = createPortHTTPHandle({
      postMessage() {
        throw new Error("send-failed");
      },
      onMessage: () => () => undefined,
    });
    await expect(brokenClient(`${baseUrl}/x`)).rejects.toThrow("send-failed");

    const throwConnectClient = createPortHTTPHandle({
      ensureConnected() {
        throwUnknown(connectStringRejection);
      },
      postMessage: () => undefined,
      onMessage: () => () => undefined,
    });
    await expect(throwConnectClient(`${baseUrl}/x`)).rejects.toThrow(
      "connect-string-fail",
    );

    const discStreamPair = createMemoryPortPair();
    let streamRelease: (() => void) | undefined;
    const discStreamHost = attachPortHost(discStreamPair.host, {
      allowAnyOrigin: true,
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(new TextEncoder().encode("chunk1"));
                streamRelease = () => discStreamPair.disconnect();
              },
            }),
          ),
        ),
    });
    const discStreamFetch = createPortHTTPHandle(discStreamPair.client);
    const discRes = await discStreamFetch(`${baseUrl}/disc`);
    const discReader = discRes.body?.getReader();
    await discReader?.read();
    streamRelease?.();
    await expect(discReader?.read()).rejects.toThrow("Port disconnected");
    discStreamHost.close();
  });

  test("covers WebSocket binary frames, Blob ordering, error/close edge cases, and host Blob relay", async () => {
    const pair = createMemoryPortPair("json");
    const hostInstances: FakeHostSocket[] = [];

    class FakeHostSocket extends EventTarget {
      static readonly OPEN = 1;
      readonly url: string;
      readonly received: unknown[] = [];
      readyState = 0;
      protocol = "sub.v1";
      extensions = "permessage-deflate";
      bufferedAmount = 0;
      throwOnSend = false;
      throwOnClose = false;

      constructor(url: string | URL) {
        super();
        if (String(url).includes("/throw-ctor-err")) {
          throw new Error("ctor-error-obj");
        }
        if (String(url).includes("/throw-ctor")) {
          throwUnknown(ctorStringRejection);
        }
        this.url = String(url);
        hostInstances.push(this);
      }

      send(data: unknown): void {
        if (this.throwOnSend) {
          throw new Error("socket-send-boom");
        }
        this.received.push(data);
      }

      close(code?: number, reason?: string): void {
        if (this.throwOnClose) {
          throw new Error("socket-close-boom");
        }
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(
          new CloseEvent("close", {
            code: code ?? 1000,
            reason: reason ?? "",
            wasClean: true,
          }),
        );
      }

      emitOpen(): void {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      }

      emitMessage(data: unknown): void {
        this.dispatchEvent(new MessageEvent("message", { data }));
      }

      emitError(): void {
        this.dispatchEvent(new Event("error"));
      }
    }

    const host = attachPortHost(pair.host, {
      allowAnyOrigin: true,
      mode: "json",
      chunkSize: 3,
      WebSocket: FakeHostSocket,
    });
    onTestFinished(() => host.close());

    const WsCtor = createPortWebSocketHandle(pair.client, {
      mode: "json",
      chunkSize: 3,
    });

    // 1. Constructor throws on host -> error + close(1006).
    const badWs = new WsCtor("ws://example.com/throw-ctor");
    const badClosed = await new Promise<CloseEvent>((resolve) => {
      badWs.addEventListener("close", (ev) => {
        if (ev instanceof CloseEvent) resolve(ev);
      });
    });
    expect(badClosed.code).toBe(1006);

    const badObjWs = new WsCtor("ws://example.com/throw-ctor-err");
    const badObjClosed = await new Promise<CloseEvent>((resolve) => {
      badObjWs.addEventListener("close", (ev) => {
        if (ev instanceof CloseEvent) resolve(ev);
      });
    });
    expect(badObjClosed.code).toBe(1006);
    expect(badObjClosed.reason).toBe("ctor-error-obj");

    // 2. Denied origin on WebSocket -> error + close(1006).
    const deniedWs = new WsCtor("ftp://example.com/bad-scheme");
    const deniedClosed = await new Promise<CloseEvent>((resolve) => {
      deniedWs.addEventListener("close", (ev) => {
        if (ev instanceof CloseEvent) resolve(ev);
      });
    });
    expect(deniedClosed.code).toBe(1006);

    // 3. Full binary / Blob / ArrayBufferView / multi-chunk / ordering test.
    const ws = new WsCtor(new URL("ws://example.com/chat"), "single.proto");
    expect(() => ws.send("early")).toThrow();
    expect(() => ws.close(1001)).toThrow();
    expect(() => ws.close(1000, "x".repeat(124))).toThrow();

    let hostSocket: FakeHostSocket | undefined;
    await vi.waitFor(() => {
      hostSocket = hostInstances.at(-1);
      expect(hostSocket).toBeDefined();
    });
    hostSocket?.emitOpen();
    expect(ws.readyState).toBe(1);

    // Multi-chunk ArrayBufferView & ArrayBuffer.
    ws.send(new Uint8Array([1, 2, 3, 4, 5]));
    ws.send(new Uint8Array([6, 7]).buffer);

    // Standalone single Blob (hits tail #sendChain reset) + chained Blobs.
    ws.send(new Blob([new Uint8Array([77])]));
    await vi.waitFor(() => expect(hostSocket?.received.length).toBe(3));

    const blob1 = new Blob([new Uint8Array([8, 9, 10, 11])]);
    const blob2 = new Blob([new Uint8Array([12])]);
    const failingBlob = new Blob(["fail"]);
    Object.defineProperty(failingBlob, "arrayBuffer", {
      value: () => Promise.reject(new Error("blob-read-failed")),
    });
    ws.send(blob1);
    ws.send(blob2);
    ws.send(failingBlob);
    ws.send("after-blobs");

    await vi.waitFor(() => expect(hostSocket?.received.length).toBe(6));
    expect(hostSocket?.received).toEqual([
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array([6, 7]),
      new Uint8Array([77]),
      new Uint8Array([8, 9, 10, 11]),
      new Uint8Array([12]),
      "after-blobs",
    ]);

    // Incoming frames from host: wait for Blob frame in "blob" mode before switching to "arraybuffer".
    const clientReceived: unknown[] = [];
    let wsErrorCount = 0;
    ws.addEventListener("message", (ev) => {
      if (ev instanceof MessageEvent) {
        clientReceived.push(ev.data);
      }
    });
    ws.addEventListener("error", () => {
      wsErrorCount += 1;
    });
    ws.binaryType = "blob";
    hostSocket?.emitMessage(new Blob([new Uint8Array([21, 22, 23, 24])]));
    await vi.waitFor(() => expect(clientReceived.length).toBe(1));
    expect(clientReceived[0]).toBeInstanceOf(Blob);

    ws.binaryType = "arraybuffer";
    hostSocket?.emitMessage(new Uint8Array([31, 32, 33, 34]));
    hostSocket?.emitMessage(new Uint8Array([41, 42]).buffer);
    hostSocket?.emitMessage(12345);
    hostSocket?.emitMessage("text-frame");
    hostSocket?.emitError();
    await vi.waitFor(() => {
      expect(clientReceived.length).toBe(4);
      expect(wsErrorCount).toBe(1);
    });

    expect(clientReceived.length).toBe(4);
    expect(clientReceived[3]).toBe("text-frame");
    expect(clientReceived[2]).toBeInstanceOf(ArrayBuffer);

    // Send Blob + queued text send that resolve AFTER ws closes locally.
    const slowBlobGate = Promise.withResolvers<ArrayBuffer>();
    const closingBlob = new Blob(["late"]);
    Object.defineProperty(closingBlob, "arrayBuffer", {
      value: () => slowBlobGate.promise,
    });
    ws.send(closingBlob);
    ws.send("after-closing-blob");

    // Swallow send error on host socket.
    if (hostSocket !== undefined) {
      hostSocket.throwOnSend = true;
      hostSocket.throwOnClose = true;
    }
    ws.send("swallowed");
    ws.send(new Uint8Array([99]));

    // Close once & duplicate close(), then resolve slow blob.
    ws.close(3000, "custom");
    ws.close();
    ws.send("ignored-while-closing");
    slowBlobGate.resolve(new Uint8Array([1]).buffer);
    await slowBlobGate.promise;
    await vi.waitFor(() => expect(ws.bufferedAmount).toBe(0));
    expect(ws.readyState).toBe(2);

    // Late host socket events after close are ignored cleanly (wait until arrayBuffer() is actually pending).
    const blobReadStarted = Promise.withResolvers<void>();
    const delayedBlobGate = Promise.withResolvers<ArrayBuffer>();
    const lateBlob = new Blob(["host-late"]);
    Object.defineProperty(lateBlob, "arrayBuffer", {
      value: () => {
        blobReadStarted.resolve();
        return delayedBlobGate.promise;
      },
    });
    hostSocket?.emitMessage(lateBlob);
    await blobReadStarted.promise;

    // Host close & swallow socket.close throw.
    host.close();
    hostSocket?.emitOpen();
    hostSocket?.emitMessage("after-host-close");
    hostSocket?.emitError();
    delayedBlobGate.resolve(new Uint8Array([2]).buffer);
    await delayedBlobGate.promise;
    await Promise.resolve();
    await Promise.resolve();
  });

  test("handles malformed wire frames, corrupt payloads, client port.close, and synchronous constructor failure", async () => {
    const pair = createMemoryPortPair("json");
    const host = attachPortHost(pair.host, {
      allowAnyOrigin: true,
      mode: "json",
    });
    onTestFinished(() => host.close());

    // Malformed frames fed directly to host are safely ignored.
    const invalidFrames: unknown[] = [
      null,
      [],
      { v: 2, id: 1, kind: "http.open" },
      { v: 1, id: 1, kind: 123 },
      { v: 1, id: 1, kind: "port.close" },
      { v: 1, id: 0, kind: "http.open" },
      { v: 1, id: 1, kind: "unknown.kind" },
      { v: 1, id: 1, kind: "http.open", url: 123 },
      {
        v: 1,
        id: 1,
        kind: "http.open",
        url: "http://x",
        method: "GET",
        headers: "bad",
        hasBody: false,
        credits: 1,
      },
      {
        v: 1,
        id: 1,
        kind: "http.open",
        url: "http://x",
        method: "GET",
        headers: [["a"]],
        hasBody: false,
        credits: 1,
      },
      {
        v: 1,
        id: 1,
        kind: "http.open",
        url: "http://x",
        method: "GET",
        headers: [[1, "b"]],
        hasBody: false,
        credits: 1,
      },
      { v: 1, id: 1, kind: "http.body", done: "nope" },
      { v: 1, id: 1, kind: "http.body", done: false, chunk: 999 },
      { v: 1, id: 1, kind: "http.pull", credits: 0 },
      { v: 1, id: 1, kind: "http.head", status: "200" },
      { v: 1, id: 1, kind: "http.chunk", chunk: 123 },
      { v: 1, id: 1, kind: "http.error", message: 123 },
      { v: 1, id: 1, kind: "http.error", message: "ok", name: 123 },
      { v: 1, id: 1, kind: "ws.open", url: 123, protocols: [] },
      { v: 1, id: 1, kind: "ws.open", url: "ws://x", protocols: "not-array" },
      { v: 1, id: 1, kind: "ws.open", url: "ws://x", protocols: [123] },
      { v: 1, id: 1, kind: "ws.opened", protocol: 1, extensions: "" },
      {
        v: 1,
        id: 1,
        kind: "ws.send",
        dataType: "text",
        data: "hi",
        done: "no",
      },
      { v: 1, id: 1, kind: "ws.send", dataType: "text", data: 123, done: true },
      {
        v: 1,
        id: 1,
        kind: "ws.send",
        dataType: "binary",
        data: "QQ==",
        done: true,
      },
      {
        v: 1,
        id: 1,
        kind: "ws.send",
        dataType: "binary",
        data: 123,
        done: true,
      },
      { v: 1, id: 1, kind: "ws.close", code: "1000" },
      {
        v: 1,
        id: 1,
        kind: "ws.closed",
        code: 1000,
        reason: 123,
        wasClean: true,
      },
      { v: 1, id: 999, kind: "http.body", done: false, chunk: "AA==" },
      { v: 1, id: 999, kind: "http.pull", credits: 1 },
      {
        v: 1,
        id: 999,
        kind: "ws.send",
        dataType: "text",
        data: "x",
        done: true,
      },
      { v: 1, id: 999, kind: "ws.close", code: 1000 },
    ];
    for (const frame of invalidFrames) {
      pair.toHostRaw(frame);
    }

    // Corrupt Base64 chunk inside http.body triggers host rejection.
    const f = fixture(baseUrl, token);
    const errUrl = await f.endpoint("bad-body", "respond", { status: 200 });
    const badBodyErr = new Promise<unknown>((resolve) => {
      const unsub = pair.client.onMessage((msg) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "id" in msg &&
          msg.id === 77
        ) {
          unsub();
          resolve(msg);
        }
      });
    });
    pair.toHostRaw({
      v: 1,
      id: 77,
      kind: "http.open",
      url: errUrl,
      method: "POST",
      headers: [],
      hasBody: true,
      credits: 4,
    });
    pair.toHostRaw({
      v: 1,
      id: 77,
      kind: "http.body",
      chunk: "!!!not-base64!!!",
      done: false,
    });
    await expect(badBodyErr).resolves.toMatchObject({
      kind: "http.error",
      message: "Invalid HTTP request body chunk",
    });

    // Duplicate open ids ignored.
    pair.toHostRaw({
      v: 1,
      id: 78,
      kind: "http.open",
      url: errUrl,
      method: "GET",
      headers: [],
      hasBody: false,
      credits: 4,
    });
    pair.toHostRaw({
      v: 1,
      id: 78,
      kind: "http.open",
      url: errUrl,
      method: "GET",
      headers: [],
      hasBody: false,
      credits: 4,
    });

    // Trigger ws policy check (to ws-pair) and wait for socket before sending corrupt ws.send.
    const hostWsPair = createMemoryPortPair("json");
    const dummySockets: DummyWs[] = [];
    class DummyWs extends EventTarget {
      static readonly OPEN = 1;
      readonly url = "ws://127.0.0.1:1/ws";
      readonly received: unknown[] = [];
      protocol = "";
      extensions = "";
      bufferedAmount = 0;
      readyState = 1;
      constructor() {
        super();
        dummySockets.push(this);
      }
      send(data: unknown): void {
        this.received.push(data);
      }
      close(): void {}
    }
    const hostWsTest = attachPortHost(hostWsPair.host, {
      allowAnyOrigin: true,
      mode: "json",
      WebSocket: DummyWs,
    });
    hostWsPair.toHostRaw({
      v: 1,
      id: 79,
      kind: "ws.open",
      url: "ws://127.0.0.1:1/ws",
      protocols: [],
    });
    hostWsPair.toHostRaw({
      v: 1,
      id: 79,
      kind: "ws.open",
      url: "ws://127.0.0.1:1/ws",
      protocols: [],
    });
    await vi.waitFor(() => expect(dummySockets.length).toBe(1));
    hostWsPair.toHostRaw({
      v: 1,
      id: 79,
      kind: "ws.send",
      dataType: "binary",
      data: "QQ==",
      done: false,
    });
    hostWsPair.toHostRaw({
      v: 1,
      id: 79,
      kind: "ws.send",
      dataType: "binary",
      data: "!!!not-base64!!!",
      done: true,
    });
    hostWsPair.toHostRaw({
      v: 1,
      id: 79,
      kind: "ws.send",
      dataType: "binary",
      data: "Qg==",
      done: true,
    });
    expect(dummySockets[0]?.received).toEqual([new Uint8Array([66])]);
    hostWsTest.close();

    pair.toHostRaw({ v: 1, id: 1, kind: "http.end" });

    // Duplicate http.abort ignored cleanly.
    pair.toHostRaw({ v: 1, id: 77, kind: "http.abort" });
    pair.toHostRaw({ v: 1, id: 77, kind: "http.abort" });

    // Client-side malformed/corrupt frames & port.close teardown.
    const clientFetch = createPortHTTPHandle(pair.client, { mode: "json" });
    const WsCtor = createPortWebSocketHandle(pair.client, { mode: "json" });

    // Unknown channel & invalid frames sent to client.
    pair.toClientRaw(null);
    pair.toClientRaw({ v: 1, id: 999, kind: "http.end" });

    // Early http.chunk before http.head & unexpected client frame ignored.
    const earlyChunkPair = createMemoryPortPair("json");
    const earlyChunkFetch = createPortHTTPHandle(earlyChunkPair.client);
    const earlyPromise = earlyChunkFetch(`${baseUrl}/early`);
    earlyChunkPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.open",
      url: "http://x",
      method: "GET",
      headers: [],
      hasBody: false,
      credits: 1,
    });
    earlyChunkPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.chunk",
      chunk: "AA==",
    });
    earlyChunkPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.error",
      message: "done",
    });
    await expect(earlyPromise).rejects.toThrow("done");

    // Trigger corrupt http.chunk mid-stream.
    const cReq = clientFetch(`${baseUrl}/body/large`);
    const corruptPair = createMemoryPortPair("json");
    const corruptFetch = createPortHTTPHandle(corruptPair.client);
    const corruptPromise = corruptFetch(`${baseUrl}/x`);
    // Channel id is 1 on fresh mux.
    corruptPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.head",
      status: 200,
      statusText: "OK",
      headers: [],
      url: `${baseUrl}/x`,
      hasBody: true,
    });
    corruptPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.chunk",
      chunk: "!!!bad-base64!!!",
    });
    const corruptRes = await corruptPromise;
    await expect(corruptRes.body?.getReader().read()).rejects.toThrow(
      "Invalid HTTP chunk payload",
    );

    // Http error with custom error name & mid-stream error.
    const errPair = createMemoryPortPair("json");
    const errFetch = createPortHTTPHandle(errPair.client);
    const headErrPromise = errFetch(`${baseUrl}/x`);
    errPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.error",
      message: "named failure",
      name: "CustomError",
    });
    await expect(headErrPromise).rejects.toMatchObject({
      name: "CustomError",
      message: "named failure",
    });

    const midErrPromise = errFetch(`${baseUrl}/y`);
    errPair.toClientRaw({
      v: 1,
      id: 2,
      kind: "http.head",
      status: 200,
      statusText: "OK",
      headers: [],
      url: `${baseUrl}/y`,
      hasBody: true,
    });
    errPair.toClientRaw({
      v: 1,
      id: 2,
      kind: "http.error",
      message: "mid failure",
    });
    const midRes = await midErrPromise;
    await expect(midRes.body?.getReader().read()).rejects.toThrow(
      "mid failure",
    );

    // Host port.close frame closes all active client channels cleanly.
    const closePair = createMemoryPortPair("json");
    const closeFetch = createPortHTTPHandle(closePair.client);
    const pendingRes = closeFetch(`${baseUrl}/hang`);
    const CloseWs = createPortWebSocketHandle(closePair.client);
    const openWs = new CloseWs("ws://example.com/a");
    let wsCloseEvent: CloseEvent | undefined;
    openWs.addEventListener("close", (ev) => {
      if (ev instanceof CloseEvent) wsCloseEvent = ev;
    });
    closePair.toClientRaw({ v: 1, id: 0, kind: "port.close" });
    await expect(pendingRes).rejects.toThrow("Port closed by host");
    expect(wsCloseEvent?.code).toBe(1006);

    // Corrupt WebSocket binary frame -> code 1002 & closing cleanup.
    const wsPair = createMemoryPortPair("json");
    const BadFrameWs = createPortWebSocketHandle(wsPair.client);
    const badFrameWs = new BadFrameWs("ws://example.com/ws");
    let badCode: number | undefined;
    badFrameWs.addEventListener("close", (ev) => {
      if (ev instanceof CloseEvent) badCode = ev.code;
    });
    // Ignore message arriving before opened & unexpected frame kind & ws.error.
    wsPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "ws.message",
      dataType: "text",
      data: "early",
      done: true,
    });
    wsPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "ws.send",
      dataType: "text",
      data: "x",
      done: true,
    });
    wsPair.toClientRaw({ v: 1, id: 1, kind: "ws.error" });
    wsPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "ws.opened",
      protocol: "",
      extensions: "",
    });
    // Ignore duplicate ws.opened.
    wsPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "ws.opened",
      protocol: "late",
      extensions: "",
    });
    wsPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "ws.message",
      dataType: "binary",
      data: "!!!corrupt!!!",
      done: true,
    });
    expect(badCode).toBe(1002);

    // WebSocket constructor send failure -> retries when paired with withRetry!
    const retryWsEndpoint: PortEndpoint = {
      postMessage() {
        throw new Error("ws-send-sync-fail");
      },
      onMessage: () => () => undefined,
    };
    const wsRetryClient = createClient(
      withEndpoint(baseUrl),
      withPortTransport(retryWsEndpoint),
      withRetry({ maxRetries: 1, delayMs: 1, jitter: 0 }),
    );
    const dummyWs = defineWebSocket({
      path: "/socket",
      incoming: struct.string(),
    });
    const [retryErr] = await dummyWs(wsRetryClient);
    expect(retryErr).not.toBeNull();

    // WebSocket constructor ensureConnected non-Error throw -> retries & settles.
    const throwWsCtor = createPortWebSocketHandle({
      ensureConnected() {
        throwUnknown(connectStringRejection);
      },
      postMessage: () => undefined,
      onMessage: () => () => undefined,
    });
    const failedWs = new throwWsCtor("ws://127.0.0.1:1/ws");
    const failedClose = await new Promise<CloseEvent>((resolve) => {
      failedWs.addEventListener("close", (ev) => {
        if (ev instanceof CloseEvent) resolve(ev);
      });
    });
    expect(failedClose.code).toBe(1006);
    expect(failedClose.reason).toBe("connect-string-fail");

    // Host close & abort races: ws policy close, body wait close, fetch resolve after abort, reader abort.
    const wsPolicyPair = createMemoryPortPair();
    const wsPolicyGate = Promise.withResolvers<boolean>();
    let wsPolicyFinished = false;
    const wsPolicyHost = attachPortHost(wsPolicyPair.host, {
      allowAnyOrigin: true,
      allowRequest: async () => {
        try {
          return await wsPolicyGate.promise;
        } finally {
          wsPolicyFinished = true;
        }
      },
    });
    wsPolicyPair.toHostRaw({
      v: 1,
      id: 200,
      kind: "ws.open",
      url: "ws://127.0.0.1:1/race",
      protocols: [],
    });
    wsPolicyHost.close();
    wsPolicyGate.resolve(true);
    await vi.waitFor(() => expect(wsPolicyFinished).toBe(true));
    await Promise.resolve();

    const racePair = createMemoryPortPair();
    const pullStarted = Promise.withResolvers<void>();
    const pullGate = Promise.withResolvers<Uint8Array>();
    const streamRaceCancelled = Promise.withResolvers<void>();
    let bodyRacePolicyChecked = false;
    const raceHost = attachPortHost(racePair.host, {
      allowAnyOrigin: true,
      allowRequest: (ctx) => {
        if (ctx.url.pathname === "/body-race") {
          bodyRacePolicyChecked = true;
        }
        return true;
      },
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                pullStarted.resolve();
                controller.enqueue(await pullGate.promise);
              },
              cancel() {
                streamRaceCancelled.resolve();
              },
            }),
          ),
        ),
    });

    // Trigger http POST expecting body, complete body, then abort synchronously so fetch sees aborted bodyPromise resolution.
    racePair.toHostRaw({
      v: 1,
      id: 201,
      kind: "http.open",
      url: "http://127.0.0.1:1/body-race",
      method: "POST",
      headers: [],
      hasBody: true,
      credits: 2,
    });
    await vi.waitFor(() => expect(bodyRacePolicyChecked).toBe(true));
    await Promise.resolve();
    racePair.toHostRaw({
      v: 1,
      id: 201,
      kind: "http.body",
      chunk: new Uint8Array([1, 2]),
      done: true,
    });
    racePair.toHostRaw({ v: 1, id: 201, kind: "http.abort" });

    // Stream abort between reader.read() calls: wait for reader.read() -> close host -> resolve chunk.
    racePair.toHostRaw({
      v: 1,
      id: 202,
      kind: "http.open",
      url: "http://127.0.0.1:1/stream-race",
      method: "GET",
      headers: [],
      hasBody: false,
      credits: 2,
    });
    await pullStarted.promise;
    raceHost.close();
    pullGate.resolve(new Uint8Array([1, 2, 3]));
    await streamRaceCancelled.promise;

    // Pending ReadableStream upload resolved/rejected AFTER abort triggers pumpRequestBody isSettled & !settled branches.
    const uploadPair = createMemoryPortPair();
    const uploadHost = attachPortHost(uploadPair.host, {
      allowAnyOrigin: true,
    });
    const uploadFetch = createPortHTTPHandle(uploadPair.client);
    const uploadGate = Promise.withResolvers<Uint8Array>();
    const slowUploadBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await uploadGate.promise;
        controller.enqueue(next);
        controller.close();
      },
    });
    const uploadAc = new AbortController();
    const uploadReq = new Request(`${baseUrl}/body/upload`, {
      method: "POST",
      signal: uploadAc.signal,
    });
    Object.defineProperty(uploadReq, "body", { value: slowUploadBody });
    const uploadPromise = uploadFetch(uploadReq);
    uploadAc.abort(new Error("upload-cancelled"));
    uploadGate.resolve(new Uint8Array([1, 2]));
    await expect(uploadPromise).rejects.toThrow("upload-cancelled");

    const errUploadStarted = Promise.withResolvers<void>();
    const errUploadGate = Promise.withResolvers<Uint8Array>();
    const errUploadBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        errUploadStarted.resolve();
        controller.enqueue(await errUploadGate.promise);
      },
    });
    const errUploadAc = new AbortController();
    const errUploadReq = new Request(`${baseUrl}/body/upload`, {
      method: "POST",
      signal: errUploadAc.signal,
    });
    Object.defineProperty(errUploadReq, "body", { value: errUploadBody });
    const errUploadPromise = uploadFetch(errUploadReq);
    await errUploadStarted.promise;
    errUploadAc.abort(new Error("upload-cancelled-before-err"));
    errUploadGate.reject(new Error("late-upload-err"));
    await expect(errUploadPromise).rejects.toThrow(
      "upload-cancelled-before-err",
    );
    uploadHost.close();

    // Ensure background request settled cleanly before teardown.
    await cReq;

    // Client sending port.close to host tears down host cleanly.
    pair.toHostRaw({ v: 1, id: 0, kind: "port.close" });
    pair.disconnect();
    expect(new WsCtor(`ws://127.0.0.1:1/closed`)).toBeDefined();
  });

  test("forwards client withCredentials across port", async () => {
    const channel = openMessageChannel();
    const seenCredentials: Array<RequestCredentials | undefined> = [];
    const host = attachPortHost(channel.port2, {
      allowedOrigins: [baseUrl],
      fetch: async (url, init) => {
        seenCredentials.push(init?.credentials);
        return globalThis.fetch(url, init);
      },
    });
    onTestFinished(() => host.close());

    const client = createClient(
      withEndpoint(baseUrl),
      withCredentials(true),
      withPortTransport(channel.port1),
    );
    const getText = defineRequest({
      method: "GET",
      path: "/e2e/in/text",
      output: struct.string(),
    });
    const [err, value] = await getText(client);
    expect(err).toBeNull();
    expect(value).toBe("hello-text");
    expect(seenCredentials).toEqual(["include"]);
  });

  test("settles ws.close during pending policy.check without constructing a host socket", async () => {
    const pair = createMemoryPortPair();
    const policyGate = Promise.withResolvers<boolean>();
    const policyStarted = Promise.withResolvers<void>();
    let constructedCount = 0;

    class GuardedWs extends EventTarget {
      static readonly OPEN = 1;
      readonly url = "";
      protocol = "";
      extensions = "";
      bufferedAmount = 0;
      readyState = 0;
      constructor() {
        super();
        constructedCount += 1;
      }
      send(): void {}
      close(): void {}
    }

    const host = attachPortHost(pair.host, {
      allowAnyOrigin: true,
      WebSocket: GuardedWs,
      allowRequest: async () => {
        policyStarted.resolve();
        return policyGate.promise;
      },
    });
    onTestFinished(() => host.close());

    const WsCtor = createPortWebSocketHandle(pair.client);
    const ws1 = new WsCtor("ws://127.0.0.1:1/early-close-1");
    const ws2 = new WsCtor("ws://127.0.0.1:1/early-close-2");
    await policyStarted.promise;

    const closed1 = Promise.withResolvers<CloseEvent>();
    const closed2 = Promise.withResolvers<CloseEvent>();
    ws1.addEventListener("close", (ev) => {
      if (ev instanceof CloseEvent) closed1.resolve(ev);
    });
    ws2.addEventListener("close", (ev) => {
      if (ev instanceof CloseEvent) closed2.resolve(ev);
    });

    ws1.close(3001, "bye");
    ws2.close();

    const [ev1, ev2] = await Promise.all([closed1.promise, closed2.promise]);
    expect(ev1.code).toBe(3001);
    expect(ev1.reason).toBe("bye");
    expect(ev1.wasClean).toBe(false);
    expect(ws1.readyState).toBe(3);

    expect(ev2.code).toBe(1000);
    expect(ev2.reason).toBe("");
    expect(ev2.wasClean).toBe(false);
    expect(ws2.readyState).toBe(3);

    policyGate.resolve(true);
    await policyGate.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(constructedCount).toBe(0);
  });

  test("handles invalid headers on http.open/http.head, bodyDone overflow ignore, and failing host Blob", async () => {
    // 1. Invalid header in http.open -> host cleans up and emits http.error.
    const openPair = createMemoryPortPair("json");
    const openHost = attachPortHost(openPair.host, {
      allowAnyOrigin: true,
      mode: "json",
    });
    onTestFinished(() => openHost.close());

    const openErr = new Promise<unknown>((resolve) => {
      const unsub = openPair.client.onMessage((msg) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "id" in msg &&
          msg.id === 901
        ) {
          unsub();
          resolve(msg);
        }
      });
    });
    openPair.toHostRaw({
      v: 1,
      id: 901,
      kind: "http.open",
      url: `${baseUrl}/e2e/in/text`,
      method: "GET",
      headers: [["bad header", "val"]],
      hasBody: false,
      credits: 2,
    });
    await expect(openErr).resolves.toMatchObject({
      kind: "http.error",
    });

    // 2. Invalid header in http.head -> client rejects and sends http.abort.
    const headPair = createMemoryPortPair("json");
    const headSent: unknown[] = [];
    headPair.host.onMessage((msg) => {
      headSent.push(msg);
    });
    const headFetch = createPortHTTPHandle(headPair.client);
    const headPromise = headFetch(`${baseUrl}/bad-head`);
    headPair.toClientRaw({
      v: 1,
      id: 1,
      kind: "http.head",
      status: 200,
      statusText: "OK",
      headers: [["invalid header", "val"]],
      url: `${baseUrl}/bad-head`,
      hasBody: false,
    });
    await expect(headPromise).rejects.toThrow();
    expect(
      headSent.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          "kind" in m &&
          m.kind === "http.abort",
      ),
    ).toBe(true);

    // 3. Extra http.body after done: true is ignored without hitting maxRequestBodyBytes.
    const extraBodyPair = createMemoryPortPair("json");
    const fetchReady = Promise.withResolvers<void>();
    const fetchGate = Promise.withResolvers<Response>();
    let observedLen = -1;
    const extraHost = attachPortHost(extraBodyPair.host, {
      allowAnyOrigin: true,
      mode: "json",
      maxRequestBodyBytes: 4,
      fetch: async (_url, init) => {
        observedLen =
          init?.body instanceof Uint8Array ? init.body.byteLength : -1;
        fetchReady.resolve();
        return fetchGate.promise;
      },
    });
    onTestFinished(() => extraHost.close());

    const extraFetch = createPortHTTPHandle(extraBodyPair.client);
    const extraReq = extraFetch(`${baseUrl}/extra-body`, {
      method: "POST",
      body: "ab",
    });
    await fetchReady.promise;
    extraBodyPair.toHostRaw({
      v: 1,
      id: 1,
      kind: "http.body",
      chunk: "MTIzNDU2Nzg=",
      done: true,
    });
    fetchGate.resolve(new Response("ok"));
    const extraRes = await extraReq;
    expect(await extraRes.text()).toBe("ok");
    expect(observedLen).toBe(2);

    // 4. Host WebSocket Blob rejection does not stall subsequent messages or close.
    const wsPair = createMemoryPortPair("json");
    const wsInstances: FakeBlobWs[] = [];
    class FakeBlobWs extends EventTarget {
      static readonly OPEN = 1;
      readonly url = "ws://127.0.0.1:1/ws";
      protocol = "";
      extensions = "";
      bufferedAmount = 0;
      readyState = 1;
      constructor() {
        super();
        wsInstances.push(this);
      }
      send(): void {}
      close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.dispatchEvent(
          new CloseEvent("close", { code, reason, wasClean: true }),
        );
      }
    }
    const wsHost = attachPortHost(wsPair.host, {
      allowAnyOrigin: true,
      mode: "json",
      WebSocket: FakeBlobWs,
    });
    onTestFinished(() => wsHost.close());

    const WsCtor = createPortWebSocketHandle(wsPair.client, { mode: "json" });
    const ws = new WsCtor("ws://127.0.0.1:1/ws");
    await vi.waitFor(() => expect(wsInstances.at(-1)).toBeDefined());
    const wsInstance = wsInstances.at(-1);
    wsInstance?.dispatchEvent(new Event("open"));
    await vi.waitFor(() => expect(ws.readyState).toBe(1));

    const receivedTexts: unknown[] = [];
    ws.addEventListener("message", (ev) => {
      if (ev instanceof MessageEvent) receivedTexts.push(ev.data);
    });

    const badHostBlob = new Blob(["bad"]);
    Object.defineProperty(badHostBlob, "arrayBuffer", {
      value: () => Promise.reject(new Error("host-blob-fail")),
    });
    wsInstance?.dispatchEvent(
      new MessageEvent("message", { data: badHostBlob }),
    );
    wsInstance?.dispatchEvent(
      new MessageEvent("message", { data: "still-alive" }),
    );
    await vi.waitFor(() => expect(receivedTexts).toEqual(["still-alive"]));

    const closed = Promise.withResolvers<CloseEvent>();
    ws.addEventListener("close", (ev) => {
      if (ev instanceof CloseEvent) closed.resolve(ev);
    });
    ws.close(1000, "done");
    const closeEv = await closed.promise;
    expect(closeEv.code).toBe(1000);
  });

  test("handles fallback abort during arrayBuffer/openChannel, fallback send failure, and late upload error", async () => {
    // 1. Abort during fallback request.arrayBuffer().
    const fbPair = createMemoryPortPair();
    const sentFrames: unknown[] = [];
    fbPair.host.onMessage((m) => sentFrames.push(m));
    const fbFetch = createPortHTTPHandle(fbPair.client);
    const fbAc = new AbortController();
    const fbReq = new Request(`${baseUrl}/fb`, {
      method: "POST",
      body: "abc",
      signal: fbAc.signal,
    });
    Object.defineProperty(fbReq, "body", { value: undefined });
    Object.defineProperty(fbReq, "arrayBuffer", {
      value: () => {
        fbAc.abort(new Error("aborted-during-arraybuffer"));
        return Promise.resolve(new TextEncoder().encode("abc").buffer);
      },
    });
    await expect(fbFetch(fbReq)).rejects.toThrow("aborted-during-arraybuffer");
    expect(sentFrames).toEqual([]);

    // 2. Abort synchronously inside mux.openChannel (ensureConnected).
    const connAc = new AbortController();
    const connSent: unknown[] = [];
    const connFetch = createPortHTTPHandle({
      ensureConnected() {
        connAc.abort(new Error("aborted-in-ensure"));
      },
      postMessage(msg: unknown) {
        connSent.push(msg);
      },
      onMessage: () => () => undefined,
    });
    await expect(
      connFetch(`${baseUrl}/conn`, { signal: connAc.signal }),
    ).rejects.toThrow("aborted-in-ensure");
    expect(connSent).toEqual([]);

    // 3. Synchronous throw inside sendBodyBytes / sendBodyDone on fallback path triggers cleanup(true).
    const bodyFailSent: string[] = [];
    let bodyCallCount = 0;
    const bodyFailFetch = createPortHTTPHandle({
      postMessage(msg: unknown) {
        bodyCallCount += 1;
        if (
          typeof msg === "object" &&
          msg !== null &&
          "kind" in msg &&
          typeof msg.kind === "string"
        ) {
          bodyFailSent.push(msg.kind);
        }
        if (bodyCallCount === 2) {
          throw new Error("body-chunk-send-failed");
        }
      },
      onMessage: () => () => undefined,
    });
    const bodyFailReq = new Request(`${baseUrl}/fb-send-fail`, {
      method: "POST",
      body: "payload",
    });
    Object.defineProperty(bodyFailReq, "body", { value: undefined });
    await expect(bodyFailFetch(bodyFailReq)).rejects.toThrow(
      "body-chunk-send-failed",
    );
    expect(bodyFailSent).toEqual(["http.open", "http.body", "http.abort"]);

    // 4. pumpRequestBody failing after response settled (204) hits if (settled) return in failStreamOrHead.
    const lateSent: string[] = [];
    let emitLateFrame: ((msg: unknown) => void) | undefined;
    const lateFetch = createPortHTTPHandle({
      postMessage(msg: unknown) {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "kind" in msg &&
          typeof msg.kind === "string"
        ) {
          lateSent.push(msg.kind);
          if (msg.kind === "http.body") {
            emitLateFrame?.({
              v: 1,
              id: 1,
              kind: "http.head",
              status: 204,
              statusText: "No Content",
              headers: [],
              url: `${baseUrl}/late-upload-err`,
              hasBody: false,
            });
            throw new Error("late-pump-boom");
          }
        }
      },
      onMessage(listener) {
        emitLateFrame = listener;
        return () => {
          emitLateFrame = undefined;
        };
      },
    });
    const lateUploadReq = new Request(`${baseUrl}/late-upload-err`, {
      method: "POST",
      body: "payload",
    });
    Object.defineProperty(lateUploadReq, "body", {
      value: new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode("payload"));
          ctrl.close();
        },
      }),
    });
    const lateRes = await lateFetch(lateUploadReq);
    expect(lateRes.status).toBe(204);
    await Promise.resolve();
    expect(lateSent).toEqual(["http.open", "http.body"]);
  });
});
