import {
  afterEach,
  beforeEach,
  describe,
  expect,
  inject,
  test,
  vi,
} from "vitest";
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  makeResponse,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
  withSSEHandle,
  withWebSocketHandle,
  type HttpRequest,
} from "../../src";
import { createHttpRequest } from "../../src/http/request";
import { parseEndpointInput } from "../../src/internal/endpoint_input";
import { materializeOutboundRequest } from "../../src/internal/outbound_request";
import { fillUrl } from "../../src/internal/url";
import { decodeJson } from "../../src/struct/codec/json";
import { STRUCT } from "../../src/struct/symbols";
import {
  assertObject,
  assertRecord,
  isRecord,
  isUnknownArray,
  nullPrototypeRecord,
  symbolValue,
} from "../narrow";
import {
  serializeOutgoingWebSocketMessage,
  transformWebSocketMessage,
} from "../../src/web_socket/codec";
import {
  createControllableSocketClass,
  openControllableSocket,
} from "./controllable_socket";

const iso = new Date("1815-12-10T00:00:00.000Z");

function tagOf(value: unknown): unknown {
  return symbolValue(value, STRUCT);
}

type AuditRoot = {
  both: Record<string, unknown>;
  choice: Record<string, unknown>;
  items: Record<string, unknown>[];
  maybe: null;
};

function isAuditRoot(value: unknown): value is AuditRoot {
  if (
    !isRecord(value) ||
    !isRecord(value["choice"]) ||
    !isRecord(value["both"])
  ) {
    return false;
  }
  const items = value["items"];
  if (!isUnknownArray(items) || value["maybe"] !== null) return false;
  for (const item of items) {
    if (!isRecord(item)) return false;
  }
  return true;
}

function responseStream(text: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" }, status: 200 },
  );
}

describe("builder refactor adversarial audit", () => {
  test("propagates struct tags through unions, intersections, nullable values, arrays, and deep spreads", async () => {
    const Alpha = struct.object({
      kind: struct.literal("alpha"),
      displayName: struct.string().alias("display_name"),
    });
    const Beta = struct.object({
      kind: struct.literal("beta"),
      count: struct.number().alias("count_value"),
    });
    const Left = struct.object({ leftId: struct.number().alias("left_id") });
    const Right = struct.object({
      rightName: struct.string().alias("right_name"),
    });
    const Child = struct.object({
      name: struct.string().alias("child_name"),
      when: struct.date(),
    });
    const Root = struct.object({
      choice: struct.or(Alpha, Beta),
      both: struct.intersection(Left, Right),
      maybe: Child.nullable(),
      items: struct.array(Child),
      optional: Child.optional(),
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
    const parsed = await parseEndpointInput(Root, {
      choice: { displayName: "Ada", kind: "alpha" },
      both: { leftId: 7, rightName: "Lovelace" },
      items: [{ name: "A", when: iso }],
      maybe: null,
    });
    if (!isAuditRoot(parsed)) throw new Error("Expected a tagged root");
    const value = parsed;

    expect(tagOf(parsed)).toBe(Root);
    expect(tagOf(value.choice)).toBe(Alpha);
    expect(tagOf(value.both)).toBeDefined();
    const firstItem = value.items[0];
    if (!firstItem) throw new Error("Expected a child");
    expect(tagOf(firstItem)).toBe(Child);
    expect(value.maybe).toBeNull();

    const request = createHttpRequest(
      "POST",
      "/audit",
      parsed,
      (input: unknown) => {
        if (!isAuditRoot(input)) throw new Error("Expected a tagged root");
        const childSource = input.items[0];
        if (!childSource) throw new Error("Expected a child");
        const child = { ...childSource };
        return {
          body: {
            choice: { ...input.choice },
            both: input.both,
            child,
          },
        };
      },
      {
        signal: new AbortController().signal,
        baseEndpoint: "https://example.test",
      },
    );

    expect(request.body).toBe(
      '{"choice":{"kind":"alpha","display_name":"Ada"},"both":{"left_id":7,"right_name":"Lovelace"},"child":{"child_name":"A","when":"1815-12-10T00:00:00.000Z"}}',
    );
  });

  test("keeps endpoint tags visible only to symbol-aware code", async () => {
    const User = struct.object({
      displayName: struct.string().alias("display_name"),
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
    const parsed = await parseEndpointInput(User, { displayName: "Ada" });

    const parsedObject = assertObject(parsed, "parsed user");
    expect(Object.keys(parsedObject)).toEqual(["displayName"]);
    expect(JSON.stringify(parsed)).toBe('{"displayName":"Ada"}');
    expect(Object.getOwnPropertySymbols(parsedObject)).toContain(STRUCT);

    const [, publicValue] = struct.parse(User, { displayName: "Ada" });
    const publicObject = assertObject(publicValue, "public user");
    expect(Object.getOwnPropertySymbols(publicObject)).not.toContain(STRUCT);
  });

  test("rejects alias collisions after a deep spread", async () => {
    const Child = struct.object({
      displayName: struct.string().alias("display_name"),
    });
    const Root = struct.object({ child: Child });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
    const parsed = await parseEndpointInput(Root, {
      child: { displayName: "Ada" },
    });

    expect(() =>
      createHttpRequest(
        "POST",
        "/audit",
        parsed,
        (input: { child: Record<string, unknown> }) => ({
          body: { child: { ...input.child, display_name: "shadow" } },
        }),
        {
          signal: new AbortController().signal,
          baseEndpoint: "https://example.test",
        },
      ),
    ).toThrow(/display_name/);
  });

  test("preserves an own __proto__ body field instead of silently dropping it", () => {
    const body = nullPrototypeRecord();
    Object.defineProperty(body, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "safe",
      writable: true,
    });
    const request = materializeOutboundRequest({ body }, "http");
    if (typeof request.body !== "string") {
      throw new Error("Expected a string body");
    }
    const decodedValue: unknown = JSON.parse(request.body);
    const decoded = assertRecord(decodedValue, "decoded body");

    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded["__proto__"]).toBe("safe");
    expect(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: read the property itself so accessor-based prototype pollution remains observable
      (Object.prototype as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });

  test("preserves an own __proto__ query field for serializers", () => {
    const query = nullPrototypeRecord();
    Object.defineProperty(query, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "safe",
      writable: true,
    });
    const request = materializeOutboundRequest({ query }, "http");

    if (
      request.query === undefined ||
      request.query instanceof URLSearchParams
    ) {
      throw new Error("Expected a query record");
    }
    expect(Object.hasOwn(request.query, "__proto__")).toBe(true);
    expect(request.query["__proto__"]).toBe("safe");
    expect(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: read the property itself so accessor-based prototype pollution remains observable
      (Object.prototype as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });

  test("preserves an own __proto__ header field instead of silently dropping it", () => {
    const headers = nullPrototypeRecord();
    Object.defineProperty(headers, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "safe",
      writable: true,
    });
    const request = materializeOutboundRequest({ headers }, "http");

    if (!isRecord(request.headers) || request.headers instanceof Headers) {
      throw new Error("Expected a header record");
    }
    expect(Object.hasOwn(request.headers, "__proto__")).toBe(true);
    expect(request.headers["__proto__"]).toBe("safe");
    expect(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: read the property itself so accessor-based prototype pollution remains observable
      (Object.prototype as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });

  test("keeps an own constructor key in body, query, and headers", () => {
    const value = nullPrototypeRecord();
    Object.defineProperty(value, "constructor", {
      configurable: true,
      enumerable: true,
      value: "safe",
      writable: true,
    });

    const request = materializeOutboundRequest(
      { body: value, query: value, headers: value },
      "http",
    );
    if (typeof request.body !== "string") {
      throw new Error("Expected a string body");
    }
    const parsedBody: unknown = JSON.parse(request.body);
    expect(parsedBody).toMatchObject({
      constructor: "safe",
    });
    if (
      request.query === undefined ||
      request.query instanceof URLSearchParams
    ) {
      throw new Error("Expected a query record");
    }
    expect(request.query["constructor"]).toBe("safe");
    if (!isRecord(request.headers) || request.headers instanceof Headers) {
      throw new Error("Expected a header record");
    }
    expect(request.headers["constructor"]).toBe("safe");
  });

  test("rejects path injection and header CR/LF before transport", () => {
    expect(() => fillUrl("/users/:id", { id: "" })).toThrow(/non-empty/);
    expect(() => fillUrl("/users/:id", { id: "." })).toThrow(/dot segment/);
    expect(() => fillUrl("/users/:id", { id: ".." })).toThrow(/dot segment/);
    expect(fillUrl("/users/:id", { id: "../x" })).toBe("/users/..%2Fx");
    expect(fillUrl("/users/:id", { id: "%2F" })).toBe("/users/%252F");
    expect(() =>
      createHttpRequest(
        "GET",
        "/users",
        undefined,
        () => ({ headers: { "x-name": "ok\r\nInjected: yes" } }),
        {
          signal: new AbortController().signal,
          baseEndpoint: "https://example.test",
        },
      ),
    ).toThrow();
  });

  test("rejects non-plain query objects and class body objects without toJSON", () => {
    expect(() =>
      materializeOutboundRequest({ query: new Map([["q", "x"]]) }, "http"),
    ).toThrow(/query value/);
    class Payload {
      value = 7;
    }
    expect(() =>
      materializeOutboundRequest({ body: new Payload() }, "http"),
    ).toThrow(/body is not JSON data: Payload/);
    class EncodedPayload {
      value = 7;
      toJSON() {
        return { value: 7 };
      }
    }
    expect(
      materializeOutboundRequest({ body: new EncodedPayload() }, "http").body,
    ).toBe('{"value":7}');
  });

  test("passes deeply nested and large queries to the serializer after alias encoding", async () => {
    let serialized: unknown;
    let captured: HttpRequest | undefined;
    const client = createClient(
      withEndpoint("https://example.test"),
      withQuerySerializer((query) => {
        serialized = query;
        return `payload=${encodeURIComponent(JSON.stringify(query))}`;
      }),
      withInterceptors(
        createHttpInterceptor((request) => {
          captured = request;
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );
    const Search = struct.object({
      filters: struct.object({
        tagName: struct.string().alias("tag_name"),
        values: struct.array(struct.number()),
      }),
    });
    const endpoint = defineRequest({
      builder: (input) => ({ query: input.search }),
      input: struct.object({ search: Search }),
      method: "GET",
      path: "/search",
    });
    const values = Array.from({ length: 256 }, (_, index) => index);

    const [error] = await endpoint(client, {
      search: { filters: { tagName: "large", values } },
    });
    expect(error).toBeNull();
    expect(serialized).toEqual({ filters: { tag_name: "large", values } });
    expect(captured?.queryString).toContain("payload=");
  });

  test("keeps BufferSource view offsets when fetch creates the Request", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const view = bytes.subarray(1, 3);
    let received: number[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        received = [...new Uint8Array(await request.arrayBuffer())];
        return new Response(null, { status: 204 });
      }),
    );
    const upload = defineRequest({
      builder: () => ({ body: view }),
      method: "POST",
      path: "/bytes",
    });

    const [error] = await upload(client);
    expect(error).toBeNull();
    expect(received).toEqual([1, 2]);
  });

  test("surfaces stream reuse as a second-call transport failure", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    });
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        await request.arrayBuffer();
        return new Response(null, { status: 204 });
      }),
    );
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: "POST",
      path: "/stream",
    });

    const [firstError] = await upload(client);
    const [secondError] = await upload(client);
    expect(firstError).toBeNull();
    expect(secondError?.code).toBe("NET_UNREACHABLE");
  });

  test("maps non-Error, non-object, and async builder results to REQ_BUILD_FAILED", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(makeResponse({ status: 204 })),
        ),
      ),
    );
    const throwsValue = defineRequest({
      builder: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the value under test is thrown or rejected unchanged
        throw "boom";
      },
      method: "POST",
      path: "/throws",
    });
    const returnsValue = defineRequest({
      // @ts-expect-error builder must return request parts, not a number
      builder: () => 1,
      method: "POST",
      path: "/value",
    });
    const returnsPromise = defineRequest({
      // @ts-expect-error builder must be synchronous, not a promise
      builder: () => Promise.resolve({}),
      method: "POST",
      path: "/promise",
    });
    const returnsUndefined = defineRequest({
      // @ts-expect-error builder must return request parts, not undefined
      builder: () => undefined,
      method: "POST",
      path: "/undefined",
    });

    const [thrown] = await throwsValue(client);
    const [value] = await returnsValue(client);
    const [promise] = await returnsPromise(client);
    const [undefinedResult] = await returnsUndefined(client);

    expect(thrown?.code).toBe("REQ_BUILD_FAILED");
    expect(thrown?.cause).toBe("boom");
    expect(value?.code).toBe("REQ_BUILD_FAILED");
    expect(promise?.code).toBe("REQ_BUILD_FAILED");
    expect(undefinedResult).toBeNull();
  });

  test.each(["GET", "HEAD"] as const)(
    "rejects a runtime %s body even when method widened to string",
    async (method) => {
      const dynamicMethod: string = method;
      let handleCalls = 0;
      let interceptorCalls = 0;
      const client = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createHttpInterceptor(() => {
            interceptorCalls += 1;
            return Promise.resolve(makeResponse({ status: 204 }));
          }),
        ),
        withHTTPHandle(() => {
          handleCalls += 1;
          return Promise.resolve(new Response(null, { status: 204 }));
        }),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: "forbidden" }),
        method: dynamicMethod,
        path: "/body",
      });

      const [error] = await endpoint(client);
      expect(error?.code).toBe("REQ_BUILD_FAILED");
      expect(error?.message).toBe("GET/HEAD requests cannot have a body");
      expect(handleCalls).toBe(0);
      expect(interceptorCalls).toBe(0);
    },
  );

  test.each(["GET", "HEAD"] as const)(
    "rejects a runtime SSE %s body even when method widened to string",
    async (method) => {
      const dynamicMethod: string = method;
      let handleCalls = 0;
      let interceptorCalls = 0;
      const client = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createSSEInterceptor(async (request, next) => {
            interceptorCalls += 1;
            return next(request);
          }),
        ),
        withSSEHandle(() => {
          handleCalls += 1;
          return Promise.resolve(
            responseStream("event: message\ndata: ok\n\n"),
          );
        }),
      );
      const endpoint = defineEventStream({
        builder: () => ({ body: "forbidden" }),
        events: { message: struct.string() },
        method: dynamicMethod,
        path: "/events",
      });

      const [error, stream] = await endpoint(client);
      expect(error?.code).toBe("REQ_BUILD_FAILED");
      expect(error?.message).toBe("GET/HEAD requests cannot have a body");
      expect(stream).toBeUndefined();
      expect(handleCalls).toBe(0);
      expect(interceptorCalls).toBe(0);
    },
  );

  test("keeps HTTP interceptor request fields coherent after builder encoding", async () => {
    let captured: HttpRequest | undefined;
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor((request) => {
          captured = request;
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );
    const Payload = struct.object({
      displayName: struct.string().alias("display_name"),
    });
    const endpoint = defineRequest({
      builder: (input) => ({
        body: input,
        headers: { "x-request": "yes" },
        query: { page: 2 },
      }),
      input: Payload,
      method: "POST",
      path: "/coherent",
    });

    const [error] = await endpoint(client, { displayName: "Ada" });
    expect(error).toBeNull();
    expect(captured?.queryString).toBe("page=2");
    expect(captured?.queryParams?.get("page")).toBe("2");
    expect(captured?.headers?.get("x-request")).toBe("yes");
    expect(captured?.body).toBe('{"display_name":"Ada"}');
  });

  test("runs SSE builder path and query through the same request pipeline", async () => {
    let captured: HttpRequest | undefined;
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          captured = request;
          return next(request);
        }),
      ),
      withSSEHandle(() =>
        Promise.resolve(responseStream("event: message\ndata: ok\n\n")),
      ),
    );
    const feed = defineEventStream({
      builder: (input) => ({
        path: { room: input.room },
        query: { since: input.since },
      }),
      events: { message: struct.string() },
      input: struct.object({ room: struct.string(), since: struct.string() }),
      path: "/rooms/:room/events",
    });

    const [error, stream] = await feed(client, { room: "blue", since: "2" });
    expect(error).toBeNull();
    expect(captured?.endpoint).toBe("/rooms/blue/events");
    expect(captured?.queryString).toBe("since=2");
    await stream?.closed;
  });

  test("runs WebSocket builder path/query through interceptors and rejects invalid outgoing data", async () => {
    let captured: HttpRequest | undefined;
    const host = inject("testServerHost");
    const client = createClient(
      withEndpoint(host),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          captured = request;
          return next(request);
        }),
      ),
    );
    const Room = struct.object({ room: struct.string().alias("room") });
    const Chat = defineWebSocket({
      builder: (input) => ({ path: input, query: { since: "2" } }),
      incoming: struct.discriminatedUnion("type", [
        struct.object({
          roomId: struct.string().alias("room_id"),
          type: struct.literal("joined"),
          query: struct.string(),
        }),
        struct.object({
          raw: struct.string(),
          type: struct.literal("observed"),
        }),
      ]),
      input: Room,
      maxIncomingQueueSize: 4,
      outgoing: struct.object({
        text: struct.string(),
        type: struct.literal("say"),
      }),
      path: "/e2e/ws/:room",
    });

    const [error, socket] = await Chat(client, { room: "blue" });
    expect(error).toBeNull();
    expect(captured?.endpoint).toBe("/e2e/ws/blue");
    expect(captured?.queryString).toBe("since=2");
    if (!socket) throw new Error("Expected socket");
    // @ts-expect-error outgoing message must use the declared say literal
    expect(() => socket.send({ type: "wrong" })).toThrow();
    socket.close();
    await socket.closed;
  });

  // materializePath is the only guard on these values: fillUrl only receives the strings it produces.
  describe.each<[label: string, value: unknown, message: string]>([
    ["an array", ["a", "b"], 'path value for "id" must be a scalar'],
    ["an empty array", [], 'path value for "id" must be a scalar'],
    ["an object", { value: 1 }, 'path value for "id" must be a scalar'],
    ["null", null, 'path value for "id" must not be null'],
  ])("rejects %s as a builder path value", (_label, value, message) => {
    test.each(["HTTP", "SSE", "WebSocket"] as const)(
      "before the %s transport starts",
      async (transport) => {
        let handleCalls = 0;
        const opened = createOpeningSocket();
        const client = createClient(
          withEndpoint("https://example.test"),
          withHTTPHandle(() => {
            handleCalls += 1;
            return Promise.resolve(new Response(null, { status: 204 }));
          }),
          withSSEHandle(() => {
            handleCalls += 1;
            return Promise.resolve(
              responseStream("event: message\ndata: ok\n\n"),
            );
          }),
          withWebSocketHandle(opened.Socket),
        );
        const builder = (input: unknown) => {
          void input;
          return { path: { id: value } };
        };
        const execute = {
          HTTP: () =>
            defineRequest({
              // @ts-expect-error path id is intentionally not a scalar
              builder,
              method: "GET",
              path: "/items/:id",
            })(client),
          SSE: () =>
            defineEventStream({
              // @ts-expect-error path id is intentionally not a scalar
              builder,
              events: { message: struct.string() },
              path: "/items/:id",
            })(client),
          WebSocket: () =>
            defineWebSocket({
              // @ts-expect-error path id is intentionally not a scalar
              builder,
              incoming: struct.unknown(),
              maxIncomingQueueSize: 1,
              path: "/items/:id",
            })(client),
        }[transport];

        const [error, result] = await execute();

        expect(error?.code).toBe("REQ_BUILD_FAILED");
        expect(error?.message).toBe(message);
        expect(result).toBeUndefined();
        expect(handleCalls).toBe(0);
        expect(opened.counters.sockets).toBe(0);
      },
    );
  });
});

const Proto = struct.object({ value: struct.string().alias("__proto__") });

function abortingInput(controller: AbortController): { id: string } {
  const input: object = {};
  Object.defineProperty(input, "id", {
    enumerable: true,
    get() {
      controller.abort("caller stopped");
      return "ok";
    },
  });
  if (!hasId(input)) throw new Error("Expected an id property");
  return input;
}

function hasId(value: object): value is { id: string } {
  return Object.hasOwn(value, "id");
}

function sseResponse(): Response {
  return new Response('event: message\ndata: "ok"\n\n', {
    headers: { "content-type": "text/event-stream" },
  });
}

async function closeIfOpened(
  resource: { close: () => void; closed: Promise<unknown> } | undefined,
): Promise<void> {
  if (!resource) {
    return;
  }
  resource.close();
  await resource.closed;
}

function createOpeningSocket() {
  const counters = { sockets: 0 };

  class OpeningSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    bufferedAmount = 0;
    binaryType = "blob";
    extensions = "";
    protocol = "";
    readyState = OpeningSocket.CONNECTING;
    url: string;
    private readonly listeners = new Map<
      string,
      Array<(event: unknown) => void>
    >();

    constructor(url: string) {
      counters.sockets += 1;
      this.url = url;
      queueMicrotask(() => {
        this.readyState = OpeningSocket.OPEN;
        this.emit("open", {});
      });
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      const current = this.listeners.get(type);
      if (current) current.push(listener);
      else this.listeners.set(type, [listener]);
    }

    removeEventListener(
      type: string,
      listener: (event: unknown) => void,
    ): void {
      const current = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        current.filter((item) => item !== listener),
      );
    }

    send(): void {}

    close(): void {
      this.readyState = OpeningSocket.CLOSED;
      this.emit("close", { code: 1000, reason: "", wasClean: true });
    }

    emit(type: string, event: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return { Socket: OpeningSocket, counters };
}

describe("builder fixes re-audit", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("preserves __proto__ aliases through outgoing WebSocket records and incoming JSON", () => {
    const Message = struct.object({
      nested: struct.array(Proto),
      records: struct.record(Proto),
    });
    const records: unknown = JSON.parse('{"__proto__":{"value":"record"}}');
    const wire = serializeOutgoingWebSocketMessage(Message, {
      nested: [{ value: "nested" }],
      records,
    });
    expect(wire).toBe(
      '{"nested":[{"__proto__":"nested"}],"records":{"__proto__":{"__proto__":"record"}}}',
    );
    const wireValue: unknown = JSON.parse(wire);
    const decoded = assertRecord(
      decodeJson(Message, wireValue),
      "decoded message",
    );
    const decodedRecords = assertRecord(decoded["records"], "decoded records");
    expect(Object.getPrototypeOf(decodedRecords)).toBeNull();
    expect(Object.hasOwn(decodedRecords, "__proto__")).toBe(true);
    expect(decodedRecords["__proto__"]).toEqual({ value: "record" });
  });

  test("sends __proto__ alias on a real WebSocket frame with query serialization", async () => {
    let serialized: unknown;
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withQuerySerializer((query) => {
        serialized = query;
        return new URLSearchParams(
          Object.entries(query).map(([key, value]) => [key, String(value)]),
        ).toString();
      }),
    );
    const endpoint = defineWebSocket({
      builder: (input) => ({ path: { room: "audit" }, query: input }),
      incoming: struct.discriminatedUnion("type", [
        struct.object({
          type: struct.literal("joined"),
          query: struct.string(),
        }),
        struct.object({
          type: struct.literal("observed"),
          raw: struct.string(),
        }),
      ]),
      input: Proto,
      maxIncomingQueueSize: 4,
      outgoing: Proto,
      path: "/e2e/ws/:room",
    });
    const [error, socket] = await endpoint(client, { value: "query" });
    expect(error).toBeNull();
    if (!socket) throw new Error("Expected socket");
    try {
      const iterator = socket.receive[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toEqual({
        type: "joined",
        query: "__proto__=query",
      });
      const serializedObject = assertObject(serialized, "serialized query");
      expect(Object.getPrototypeOf(serializedObject)).toBeNull();
      expect(Object.hasOwn(serializedObject, "__proto__")).toBe(true);
      socket.send({ value: "frame" });
      expect((await iterator.next()).value).toEqual({
        type: "observed",
        raw: '{"__proto__":"frame"}',
      });
    } finally {
      socket.close();
      await socket.closed;
    }
  });

  test.each(["formData", "urlencoded"] as const)(
    "preserves __proto__ form arrays through HTTP %s transport",
    async (codec) => {
      let fields: FormData | undefined;
      const Form = struct[codec]({
        values: struct.array(struct.string()).alias("__proto__"),
      });
      const client = createClient(
        withEndpoint("https://example.test"),
        withHTTPHandle(async (input) => {
          if (!(input instanceof Request)) {
            throw new Error("Expected a Request");
          }
          fields = await input.formData();
          return new Response(null, { status: 204 });
        }),
      );
      const endpoint = defineRequest({
        builder: (input) => ({ body: input }),
        input: Form,
        method: "POST",
        path: "/form",
      });
      const [error] = await endpoint(client, { values: ["first", "second"] });
      expect(error).toBeNull();
      expect(fields?.getAll("__proto__")).toEqual(["first", "second"]);
    },
  );

  test.each([false, true])(
    "preserves SSE query, headers, path, body and inbound alias (custom serializer: %s)",
    async (custom) => {
      let captured: HttpRequest | undefined;
      let received: Request | undefined;
      let serialized: unknown;
      const options = custom
        ? [
            withQuerySerializer((query) => {
              serialized = query;
              return new URLSearchParams(
                Object.entries(query).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              ).toString();
            }),
          ]
        : [];
      const client = createClient(
        withEndpoint("https://example.test"),
        ...options,
        withInterceptors(
          createSSEInterceptor(async (request, next) => {
            captured = request;
            return next(request);
          }),
        ),
        withSSEHandle((input) => {
          if (!(input instanceof Request)) {
            throw new Error("Expected a Request");
          }
          received = input;
          return Promise.resolve(
            new Response('event: message\ndata: {"__proto__":"inbound"}\n\n', {
              headers: { "content-type": "text/event-stream" },
            }),
          );
        }),
      );
      const endpoint = defineEventStream({
        builder: (input) => ({
          path: input,
          query: input,
          headers: input,
          body: input,
        }),
        events: { message: Proto },
        input: Proto,
        method: "POST",
        path: "/events/:__proto__",
      });
      const [error, stream] = await endpoint(client, { value: "safe" });
      expect(error).toBeNull();
      expect(captured?.endpoint).toBe("/events/safe");
      expect(captured?.headers?.get("__proto__")).toBe("safe");
      expect(captured?.queryParams?.get("__proto__")).toBe("safe");
      expect(captured?.queryString).toBe("__proto__=safe");
      expect(captured?.body).toBe('{"__proto__":"safe"}');
      expect(received?.url).toBe(
        "https://example.test/events/safe?__proto__=safe",
      );
      expect(await received?.text()).toBe('{"__proto__":"safe"}');
      if (custom) {
        const serializedObject = assertObject(serialized, "serialized query");
        expect(Object.getPrototypeOf(serializedObject)).toBeNull();
        expect(Object.hasOwn(serializedObject, "__proto__")).toBe(true);
      }
      if (!stream) throw new Error("Expected stream");
      const events = [];
      for await (const event of stream) events.push(event);
      expect(events).toEqual([
        { event: "message", data: { value: "inbound" }, id: undefined },
      ]);
      await stream.closed;
    },
  );

  test.each([200, 400])(
    "decodes __proto__ aliases on HTTP status %s",
    async (status) => {
      const client = createClient(
        withEndpoint("https://example.test"),
        withHTTPHandle(() =>
          Promise.resolve(
            new Response('{"__proto__":"safe"}', {
              status,
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      );
      const endpoint = defineRequest({
        error: Proto,
        output: Proto,
        method: "GET",
        path: "/response",
      });
      const [error, result] = await endpoint(client);
      if (status === 200) {
        expect(error).toBeNull();
        expect(result).toEqual({ value: "safe" });
      } else {
        expect(error).toMatchObject({
          code: "HTTP_STATUS",
          data: { value: "safe" },
          status: 400,
        });
      }
    },
  );

  test("exposes derived response representations to interceptors", async () => {
    const requests: HttpRequest[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor((request) => {
          requests.push(request);
          return Promise.resolve(makeResponse({ body: "ok", status: 200 }));
        }),
      ),
    );
    await defineRequest({
      method: "GET",
      path: "/",
      output: struct.string(),
      error: struct.object({}),
    })(client);
    await defineRequest({
      method: "GET",
      path: "/",
      error: struct.arrayBuffer(),
    })(client);
    await defineRequest({ method: "GET", path: "/" })(client);
    expect(
      requests.map((request) => [
        request.responseType,
        request.errorResponseType,
      ]),
    ).toEqual([
      ["text", "json"],
      [undefined, "arraybuffer"],
      [undefined, undefined],
    ]);
  });

  test("skips a WebSocket builder when cancellation is already active", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    let builderCalls = 0;
    const client = createClient(withEndpoint("https://example.test"));
    const endpoint = defineWebSocket({
      builder: () => {
        builderCalls += 1;
        throw new Error("builder must not run after cancellation");
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: "/socket",
    });

    const [error] = await endpoint(client({ signal: controller.signal }));

    expect(builderCalls).toBe(0);
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("does not run a WebSocket builder when input parsing aborts the signal", async () => {
    const controller = new AbortController();
    const opened = createOpeningSocket();
    let builderCalls = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    );
    const endpoint = defineWebSocket({
      builder: () => {
        builderCalls += 1;
        return {};
      },
      incoming: struct.unknown(),
      input: struct.object({ id: struct.string() }),
      maxIncomingQueueSize: 1,
      path: "/socket",
    });

    const [error, session] = await endpoint(
      client({ signal: controller.signal }),
      abortingInput(controller),
    );
    await closeIfOpened(session);

    expect(builderCalls).toBe(0);
    expect(opened.counters.sockets).toBe(0);
    expect(session).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("returns NET_ABORTED when a WebSocket builder aborts and then throws", async () => {
    const controller = new AbortController();
    const opened = createOpeningSocket();
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    );
    const endpoint = defineWebSocket({
      builder: () => {
        controller.abort("caller stopped");
        throw new Error("build failed after abort");
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: "/socket",
    });

    const [error, session] = await endpoint(
      client({ signal: controller.signal }),
    );

    expect(opened.counters.sockets).toBe(0);
    expect(session).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("returns NET_ABORTED before WebSocket queue validation when cancellation is already active", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 0,
      path: "/socket",
    });

    const [error, session] = await endpoint(
      createClient(withEndpoint("https://example.test"))({
        signal: controller.signal,
      }),
    );

    expect(session).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("skips an HTTP builder when cancellation is already active", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    let builderCalls = 0;
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => {
        fetches += 1;
        return Promise.resolve(new Response("ok", { status: 200 }));
      }),
    );
    const endpoint = defineRequest({
      builder: () => {
        builderCalls += 1;
        throw new Error("builder must not run after cancellation");
      },
      method: "GET",
      path: "/item",
    });

    const [error, result] = await endpoint(
      client({ signal: controller.signal }),
    );

    expect(builderCalls).toBe(0);
    expect(fetches).toBe(0);
    expect(result).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("does not run an HTTP builder when input parsing aborts the signal", async () => {
    const controller = new AbortController();
    let builderCalls = 0;
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => {
        fetches += 1;
        return Promise.resolve(new Response("ok", { status: 200 }));
      }),
    );
    const endpoint = defineRequest({
      builder: () => {
        builderCalls += 1;
        return {};
      },
      input: struct.object({ id: struct.string() }),
      method: "GET",
      path: "/item",
    });

    const [error, result] = await endpoint(
      client({ signal: controller.signal }),
      abortingInput(controller),
    );

    expect(builderCalls).toBe(0);
    expect(fetches).toBe(0);
    expect(result).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("returns NET_ABORTED when an HTTP builder aborts and then throws", async () => {
    const controller = new AbortController();
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => {
        fetches += 1;
        return Promise.resolve(new Response("ok", { status: 200 }));
      }),
    );
    const endpoint = defineRequest({
      builder: () => {
        controller.abort("caller stopped");
        throw new Error("build failed after abort");
      },
      method: "GET",
      path: "/item",
    });

    const [error, result] = await endpoint(
      client({ signal: controller.signal }),
    );

    expect(fetches).toBe(0);
    expect(result).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("aborts the HTTP transport when interceptor resolution aborts the signal", async () => {
    const controller = new AbortController();
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => {
        fetches += 1;
        return Promise.resolve(new Response("ok", { status: 200 }));
      }),
      (config) => {
        // Resolution sits after the builder cancellation check and before the chain starts.
        config.interceptors = new Proxy(config.interceptors, {
          get(target, property, receiver) {
            if (property === "filter") {
              controller.abort("caller stopped");
            }
            const value: unknown = Reflect.get(target, property, receiver);
            return value;
          },
        });
      },
    );
    const endpoint = defineRequest({ method: "GET", path: "/item" });

    const [error, result] = await endpoint(
      client({ signal: controller.signal }),
    );

    expect(fetches).toBe(0);
    expect(result).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("skips an SSE builder when cancellation is already active", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    let builderCalls = 0;
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() => {
        fetches += 1;
        return Promise.resolve(sseResponse());
      }),
    );
    const endpoint = defineEventStream({
      builder: () => {
        builderCalls += 1;
        throw new Error("builder must not run after cancellation");
      },
      events: { message: struct.string() },
      path: "/events",
    });

    const [error, stream] = await endpoint(
      client({ signal: controller.signal }),
    );
    await closeIfOpened(stream);

    expect(builderCalls).toBe(0);
    expect(fetches).toBe(0);
    expect(stream).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("does not run an SSE builder when input parsing aborts the signal", async () => {
    const controller = new AbortController();
    let builderCalls = 0;
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() => {
        fetches += 1;
        return Promise.resolve(sseResponse());
      }),
    );
    const endpoint = defineEventStream({
      builder: () => {
        builderCalls += 1;
        return {};
      },
      events: { message: struct.string() },
      input: struct.object({ id: struct.string() }),
      path: "/events",
    });

    const [error, stream] = await endpoint(
      client({ signal: controller.signal }),
      abortingInput(controller),
    );
    await closeIfOpened(stream);

    expect(builderCalls).toBe(0);
    expect(fetches).toBe(0);
    expect(stream).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("returns NET_ABORTED when an SSE builder aborts and then throws", async () => {
    const controller = new AbortController();
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() => {
        fetches += 1;
        return Promise.resolve(sseResponse());
      }),
    );
    const endpoint = defineEventStream({
      builder: () => {
        controller.abort("caller stopped");
        throw new Error("build failed after abort");
      },
      events: { message: struct.string() },
      path: "/events",
    });

    const [error, stream] = await endpoint(
      client({ signal: controller.signal }),
    );

    expect(fetches).toBe(0);
    expect(stream).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("returns NET_ABORTED before SSE limit validation when cancellation is already active", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    const endpoint = defineEventStream({
      events: { message: struct.string() },
      path: "/events",
    });

    const [error, stream] = await endpoint(
      createClient(withEndpoint("https://example.test"))({
        signal: controller.signal,
      }),
    );

    expect(stream).toBeUndefined();
    expect(error).toMatchObject({ code: "NET_ABORTED" });
  });

  test("BUILDER-PROTOTYPE-002: accepts an intersection with a logical __proto__ field", async () => {
    const Left = struct.object({
      ["__proto__"]: struct.string().alias("proto_value"),
    });
    const Input = struct.intersection(
      Left,
      struct.object({ label: struct.string() }),
    );
    // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
    const parsed = await parseEndpointInput(Input, {
      ["__proto__"]: "safe",
      label: "left",
    });
    const request = materializeOutboundRequest({ body: parsed }, "http");
    expect(request.body).toBe('{"proto_value":"safe","label":"left"}');
  });

  test("decodes aliased fields in SSE JSON event data", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response('event: message\ndata: {"error_code":"DENIED"}\n\n', {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    );
    const endpoint = defineEventStream({
      events: {
        message: struct.object({ code: struct.string().alias("error_code") }),
      },
      path: "/events",
    });
    const [error, stream] = await endpoint(client);
    expect(error).toBeNull();
    if (!stream) {
      throw new Error("Expected stream");
    }
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toEqual([
      { data: { code: "DENIED" }, event: "message", id: undefined },
    ]);
  });

  test("decodes aliased fields on an incoming WebSocket frame", async () => {
    const decoded = await transformWebSocketMessage(
      struct.object({ code: struct.string().alias("error_code") }),
      '{"error_code":"DENIED"}',
    );
    expect(decoded).toEqual({ code: "DENIED" });

    let opened: FakeSocket | undefined;
    class FakeSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSING = 2;
      static CLOSED = 3;

      bufferedAmount = 0;
      binaryType = "blob";
      extensions = "";
      protocol = "";
      readyState = FakeSocket.CONNECTING;
      url: string;
      private readonly listeners = new Map<
        string,
        Array<(event: unknown) => void>
      >();

      constructor(url: string) {
        this.url = url;
        // oxlint-disable-next-line typescript/no-this-alias -- the test has to emit a frame on the constructed socket
        opened = this;
        queueMicrotask(() => {
          this.readyState = FakeSocket.OPEN;
          this.emit("open", {});
        });
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const current = this.listeners.get(type);
        if (current) current.push(listener);
        else this.listeners.set(type, [listener]);
      }

      removeEventListener(
        type: string,
        listener: (event: unknown) => void,
      ): void {
        const current = this.listeners.get(type) ?? [];
        this.listeners.set(
          type,
          current.filter((item) => item !== listener),
        );
      }

      send(): void {}

      close(code = 1000, reason = ""): void {
        this.readyState = FakeSocket.CLOSED;
        this.emit("close", { code, reason, wasClean: true });
      }

      emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(FakeSocket),
    );
    const endpoint = defineWebSocket({
      incoming: struct.object({ code: struct.string().alias("error_code") }),
      maxIncomingQueueSize: 4,
      path: "/socket",
    });
    const [openError, session] = await endpoint(client);
    expect(openError).toBeNull();
    if (!session || !opened) {
      throw new Error("Expected socket");
    }
    const pending = session.receive[Symbol.asyncIterator]().next();
    opened.emit("message", { data: '{"error_code":"DENIED"}' });
    await expect(pending).resolves.toEqual({
      done: false,
      value: { code: "DENIED" },
    });
    session.close();
    await session.closed;
  });

  test("decodes aliased fields before heartbeat acknowledgement classification", async () => {
    vi.useFakeTimers();
    const { Socket, latest } = createControllableSocketClass();
    try {
      const seen: unknown[] = [];
      const client = createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(Socket),
      );
      const endpoint = defineWebSocket({
        incoming: struct.object({
          kind: struct.string().alias("type"),
          ok: struct.boolean(),
        }),
        maxIncomingQueueSize: 4,
        outgoing: struct.object({
          at: struct.number(),
          type: struct.literal("ping"),
        }),
        path: "/ws/heartbeat",
      });
      const pending = endpoint(
        client({
          heartbeat: {
            intervalMs: 10,
            isAck: (message: unknown) => {
              if (
                typeof message !== "object" ||
                message === null ||
                !("kind" in message) ||
                !("ok" in message)
              ) {
                return false;
              }
              seen.push({
                kind: String(message.kind),
                ok: message.ok === true,
              });
              return message.kind === "pong";
            },
            message: () => ({ at: 1, type: "ping" as const }),
            timeoutMs: 100,
          },
        }),
      );
      const [error, session] = await openControllableSocket(pending, latest);
      expect(error).toBeNull();
      const socket = latest();
      if (!session || !socket) {
        throw new Error("Expected socket session");
      }
      const runtimeErrors: unknown[] = [];
      session.onRuntimeError((cause) => {
        runtimeErrors.push(cause);
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(JSON.parse(socket.sent[0] ?? "")).toEqual({ at: 1, type: "ping" });
      // The wire key is `type`. Classification must see the decoded logical key `kind`.
      socket.triggerMessage('{"ok":true,"type":"pong"}');
      // Flush the message pump without moving the clock. vi.waitFor advances fake timers and
      // would let the next interval arm a fresh deadline inside this timeout window.
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([{ kind: "pong", ok: true }]);
      await vi.advanceTimersByTimeAsync(100);

      expect(runtimeErrors).toEqual([]);
      expect(session.state).toBe("open");
      session.close(1000, "heartbeat-ok");
      socket.triggerClose({
        code: 1000,
        reason: "heartbeat-ok",
        wasClean: true,
      });
      await expect(session.closed).resolves.toMatchObject({
        code: 1000,
        reason: "heartbeat-ok",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("SSE-ERROR-ALIAS-001: decodes aliased fields in a failed SSE handshake", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response('{"error_code":"DENIED"}', {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const endpoint = defineEventStream({
      error: struct.object({ code: struct.string().alias("error_code") }),
      events: { message: struct.string() },
      path: "/events",
    });
    const [error] = await endpoint(client);
    expect(error).toMatchObject({
      code: "HTTP_STATUS",
      data: { code: "DENIED" },
      status: 403,
    });
  });
});

const Profile = struct.object({
  displayName: struct.string().alias("display_name"),
});
const Input = struct.object({ profile: Profile });

test("runtime tags survive records, tuples, and chained modifiers used by the type probes", async () => {
  const User = struct.object({ id: struct.string().alias("user_id") });
  // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
  const record = await parseEndpointInput(struct.record(User), {
    selected: { id: "42" },
  });
  // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
  const tuple = await parseEndpointInput(struct.tuple([User]), [{ id: "42" }]);
  // eslint-disable-next-line @typescript-eslint/await-thenable -- INTENT: retain the original await boundary and its microtask timing after input parsing
  const modified = await parseEndpointInput(User.optional().nullable(), {
    id: "42",
  });
  for (const value of [record["selected"], tuple[0], modified]) {
    if (!value) throw new Error("Expected a parsed object");
    expect(Object.getOwnPropertySymbols(value)).toContain(STRUCT);
    expect(materializeOutboundRequest({ path: value }, "http").params).toEqual({
      user_id: "42",
    });
  }
});

test("preserves a nested spread extra when its parent remains typed", async () => {
  let sentBody: unknown;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (request) => {
      sentBody = await new Request(request).json();
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    input: Input,
    method: "POST",
    path: "/profile",
    builder: (input) => ({
      body: { ...input, profile: { ...input.profile, role: "admin" } },
    }),
  });

  const [fault] = await endpoint(client, { profile: { displayName: "Ada" } });
  expect(fault).toBeNull();
  expect(sentBody).toEqual({ profile: { display_name: "Ada", role: "admin" } });
});

test("rejects a nested spread wire-key collision before sending a typed parent", async () => {
  let calls = 0;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(() => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  const endpoint = defineRequest({
    input: Input,
    method: "POST",
    path: "/profile",
    builder: (input) => ({
      body: { ...input, profile: { ...input.profile, display_name: "shadow" } },
    }),
  });

  const [fault] = await endpoint(client, { profile: { displayName: "Ada" } });
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(calls).toBe(0);
});
