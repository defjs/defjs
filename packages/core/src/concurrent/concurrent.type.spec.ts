import { expectTypeOf, test } from "vitest";
import type { Client } from "../client";
import { createClient } from "../client";
import type {
  Fault,
  FaultOf,
  HttpStatusFaultOf,
  PreflightFault,
} from "../error";
import { defineRequest } from "../http";
import type { DecodedResponse, HttpAwaitResult, HttpMeta } from "../http";
import { defineEventStream } from "../sse";
import type {
  EventStreamHandle,
  EventStreamOpenInfo,
  StreamAwaitResult,
} from "../sse";
import { struct } from "../struct";
import { defineWebSocket } from "../web_socket";
import type {
  SocketAwaitResult,
  WebSocketConnectionInfo,
  WebSocketSession,
} from "../web_socket";
import {
  concurrentAll,
  concurrentAllSettled,
  concurrentMap,
  concurrentMapSettled,
} from "./index";

// @ts-expect-error concurrentMap lives in @defjs/core/concurrent, not the root entry
import { concurrentMap as rootConcurrentMap } from "../index";
// @ts-expect-error concurrentAll lives in @defjs/core/concurrent, not the root entry
import { concurrentAll as rootConcurrentAll } from "../index";

const client = createClient();

const orderSchema = struct.object({
  id: struct.number(),
  total: struct.number(),
});
const apiErrorSchema = struct.object({ code: struct.string() });
const pingEventSchema = struct.object({ seq: struct.number() });
const wsInSchema = struct.object({ text: struct.string() });

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: ({ id }) => ({ path: { id } }),
  output: orderSchema,
  error: apiErrorSchema,
});

const getOptional = defineRequest({
  method: "GET",
  path: "/opt",
  input: struct.object({ q: struct.string() }).optional(),
  builder: (input) => (input ? { query: { q: input.q } } : {}),
});

const getHealth = defineRequest({
  method: "GET",
  path: "/health",
});

const streamTopic = defineEventStream({
  path: "/topics/:topic",
  input: struct.object({ topic: struct.string() }),
  builder: ({ topic }) => ({ path: { topic } }),
  events: { ping: pingEventSchema },
  error: apiErrorSchema,
});

const streamHealth = defineEventStream({
  path: "/events",
  events: { ping: pingEventSchema },
});

const connectRoom = defineWebSocket({
  path: "/rooms/:room",
  input: struct.object({ room: struct.string() }),
  builder: ({ room }) => ({ path: { room } }),
  incoming: wsInSchema,
});

const connectLobby = defineWebSocket({
  path: "/lobby",
  incoming: wsInSchema,
});

test("concurrent operations stay excluded from @defjs/core root", () => {
  void rootConcurrentMap;
  void rootConcurrentAll;
});

test("concurrentMap and concurrentMapSettled infer inputs, values, responses, and reject zero-arg operations", () => {
  type Order = { id: number; total: number };
  type ApiError = { code: string };

  const mapped = concurrentMap(client, getOrder, [{ id: 1 }, { id: 2 }]);
  expectTypeOf(mapped).resolves.toEqualTypeOf<
    | [err: null, results: Order[], responses: DecodedResponse<Order>[]]
    | [err: FaultOf<ApiError>, results: undefined, responses: undefined]
  >();

  const settled = concurrentMapSettled(client, getOrder, [{ id: 1 }]);
  expectTypeOf(settled).resolves.toEqualTypeOf<
    HttpAwaitResult<Order, ApiError>[]
  >();

  const optionalMapped = concurrentMap(client, getOptional, [
    { q: "a" },
    undefined,
  ]);
  expectTypeOf(optionalMapped).resolves.toEqualTypeOf<
    | [err: null, results: undefined[], responses: HttpMeta[]]
    | [err: FaultOf<undefined>, results: undefined, responses: undefined]
  >();

  const sseMapped = concurrentMap(client, streamTopic, [{ topic: "news" }]);
  expectTypeOf(sseMapped).resolves.toEqualTypeOf<
    | [
        err: null,
        results: EventStreamHandle<{
          data: { seq: number };
          event: "ping";
          id?: string;
        }>[],
        responses: EventStreamOpenInfo[],
      ]
    | [
        err: Fault<typeof apiErrorSchema> | HttpStatusFaultOf<undefined>,
        results: undefined,
        responses: undefined,
      ]
  >();

  const wsMapped = concurrentMap(client, connectRoom, [{ room: "general" }]);
  expectTypeOf(wsMapped).resolves.toEqualTypeOf<
    | [
        err: null,
        results: WebSocketSession<{ text: string }, never>[],
        responses: WebSocketConnectionInfo[],
      ]
    | [err: Fault<undefined>, results: undefined, responses: undefined]
  >();

  // @ts-expect-error zero-argument HTTP endpoint is rejected in concurrentMap
  void concurrentMap(client, getHealth, []);
  // @ts-expect-error zero-argument HTTP endpoint is rejected in concurrentMapSettled
  void concurrentMapSettled(client, getHealth, []);
  // @ts-expect-error zero-argument SSE endpoint is rejected in concurrentMap
  void concurrentMap(client, streamHealth, []);
  // @ts-expect-error zero-argument WebSocket endpoint is rejected in concurrentMap
  void concurrentMap(client, connectLobby, []);
  // @ts-expect-error wrong input property type is rejected in concurrentMap
  void concurrentMap(client, getOrder, [{ id: "wrong" }]);
});

test("concurrentAll and concurrentAllSettled infer heterogeneous tuples and records without as const", () => {
  type Order = { id: number; total: number };
  type ApiError = { code: string };
  type PingEvent = { data: { seq: number }; event: "ping"; id?: string };

  const tupleBatch = concurrentAll(client, [
    (c) => getOrder(c, { id: 1 }),
    (c) => getHealth(c),
    (c) => streamHealth(c),
    (c) => connectLobby(c),
  ]);

  expectTypeOf(tupleBatch).resolves.toEqualTypeOf<
    | [
        err: null,
        results: [
          Order,
          undefined,
          EventStreamHandle<PingEvent>,
          WebSocketSession<{ text: string }, never>,
        ],
        responses: [
          DecodedResponse<Order>,
          HttpMeta,
          EventStreamOpenInfo,
          WebSocketConnectionInfo,
        ],
      ]
    | [
        err: FaultOf<ApiError> | HttpStatusFaultOf<undefined>,
        results: undefined,
        responses: undefined,
      ]
  >();

  const customTuple = concurrentAll(client, [
    (): Promise<[null, string] | [PreflightFault, undefined]> =>
      Promise.resolve([null, "ok"]),
  ]);
  expectTypeOf(customTuple).resolves.toEqualTypeOf<
    | [err: null, results: [string], responses: [undefined]]
    | [err: PreflightFault, results: undefined, responses: undefined]
  >();

  const emptyTuple = concurrentAll(client, []);
  expectTypeOf(emptyTuple).resolves.toEqualTypeOf<
    | [err: null, results: [], responses: []]
    | [err: PreflightFault, results: undefined, responses: undefined]
  >();

  const dynamicArray: Array<(c: Client) => ReturnType<typeof getOrder>> = [
    (c) => getOrder(c, { id: 1 }),
  ];
  const arrayBatch = concurrentAll(client, dynamicArray);
  expectTypeOf(arrayBatch).resolves.toEqualTypeOf<
    | [err: null, results: Order[], responses: DecodedResponse<Order>[]]
    | [err: FaultOf<ApiError>, results: undefined, responses: undefined]
  >();

  const recordBatch = concurrentAll(client, {
    order: (c) => getOrder(c, { id: 1 }),
    health: (c) => getHealth(c),
  });
  expectTypeOf(recordBatch).resolves.toEqualTypeOf<
    | [
        err: null,
        results: { order: Order; health: undefined },
        responses: { order: DecodedResponse<Order>; health: HttpMeta },
      ]
    | [
        err: FaultOf<ApiError> | HttpStatusFaultOf<undefined>,
        results: undefined,
        responses: undefined,
      ]
  >();

  const settledTuple = concurrentAllSettled(client, [
    (c) => getOrder(c, { id: 1 }),
    (c) => streamHealth(c),
    (c) => connectLobby(c),
    (): Promise<[null, number]> => Promise.resolve([null, 42]),
  ]);
  expectTypeOf(settledTuple).resolves.toEqualTypeOf<
    [
      HttpAwaitResult<Order, ApiError>,
      StreamAwaitResult<PingEvent>,
      SocketAwaitResult<{ text: string }, never>,
      (
        | [null, number]
        | [err: PreflightFault, result: undefined, response: undefined]
      ),
    ]
  >();

  const settledRecord = concurrentAllSettled(client, {
    order: (c) => getOrder(c, { id: 1 }),
    health: (c) => getHealth(c),
  });
  expectTypeOf(settledRecord).resolves.toEqualTypeOf<{
    order: HttpAwaitResult<Order, ApiError>;
    health: HttpAwaitResult<undefined, undefined>;
  }>();
});
