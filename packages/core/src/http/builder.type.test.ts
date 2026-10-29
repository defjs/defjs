import { expectTypeOf } from "vitest";
import type { BuilderInput, HttpRequestShape } from "./http";
import type { EventStreamRequestShape } from "../sse/sse";
import { defineEventStream } from "../sse/sse";
import { struct } from "../struct";
import type { WebSocketRequestShape } from "../web_socket/web_socket";
import { defineWebSocket } from "../web_socket/web_socket";
import { defineRequest } from "./http";

const health = defineRequest({ method: "GET", path: "/health" });
health();
// @ts-expect-error an endpoint with no input does not accept an argument
health({});

const scalarInput = struct.object({ userId: struct.number().alias("user_id") });
const getUser = defineRequest({
  builder: (input) => ({ path: { user_id: input.userId } }),
  input: scalarInput,
  method: "GET",
  path: "/users/:user_id",
});
// @ts-expect-error a required input cannot be omitted
getUser();
getUser({ userId: 7 });
defineRequest({
  // @ts-expect-error path keys must match the template
  builder: (input) => ({ path: { usr_id: input.userId } }),
  input: scalarInput,
  method: "GET",
  path: "/users/:user_id",
});
defineRequest({
  builder: (input) => ({ path: input }),
  input: scalarInput,
  method: "GET",
  path: "/users/:user_id",
});

const nestedInput = struct.object({
  id: struct.number(),
  profile: struct.object({ name: struct.string() }),
});
defineRequest({
  // @ts-expect-error a tagged path value cannot carry a nested object
  builder: (input) => ({ path: input }),
  input: nestedInput,
  method: "GET",
  path: "/users/:id",
});

const optionalInput = struct.object({ id: struct.number().optional() });
defineRequest({
  // @ts-expect-error an optional field is not a path scalar
  builder: (input) => ({ path: input }),
  input: optionalInput,
  method: "GET",
  path: "/users/:id",
});

defineRequest({
  builder: (input) => ({ path: { user_id: input.userId }, query: input }),
  input: struct.object({
    tags: struct.array(struct.string()),
    userId: struct.number(),
    when: struct.date(),
  }),
  method: "GET",
  path: "/users/:user_id",
});

const UserUpdate = struct.object({
  profile: struct.object({
    displayName: struct.string().alias("display_name"),
  }),
  target: struct.object({ id: struct.number() }),
});
defineRequest({
  input: UserUpdate,
  builder: (input) => ({ path: input.target, body: input.profile }),
  method: "PATCH",
  path: "/users/:id",
});

// @ts-expect-error a declared input requires a builder
defineRequest({
  input: struct.object({ name: struct.string() }),
  method: "POST",
  path: "/x",
});

defineRequest({
  // @ts-expect-error GET cannot return a body
  builder: () => ({ body: { a: 1 } }),
  method: "GET",
  path: "/x",
});

defineRequest({
  // @ts-expect-error HEAD cannot return a body
  builder: () => ({ body: "nope" }),
  method: "HEAD",
  path: "/x",
});

const looseMethod: string = "GET";
defineRequest({
  builder: () => ({ body: { a: 1 } }),
  method: looseMethod,
  path: "/x",
});

defineWebSocket({
  // @ts-expect-error WebSocket requests cannot return headers
  builder: (input) => ({ headers: {}, path: { room: input.room } }),
  incoming: struct.unknown(),
  input: struct.object({ room: struct.string() }),
  maxIncomingQueueSize: 1,
  path: "/ws/:room",
});

defineWebSocket({
  // @ts-expect-error WebSocket requests cannot return a body
  builder: (input) => ({ body: input.room, path: { room: input.room } }),
  incoming: struct.unknown(),
  input: struct.object({ room: struct.string() }),
  maxIncomingQueueSize: 1,
  path: "/ws/:room",
});

const search = defineRequest({
  builder: (input) => ({ query: { q: input?.q } }),
  input: struct.object({ q: struct.string().optional() }).optional(),
  method: "GET",
  path: "/search",
});
search();
search({});
search({ q: "ada" });

const nullableUser = struct.object({ id: struct.number() }).nullable();
defineRequest({
  builder: (input) => ({ body: input }),
  input: nullableUser,
  method: "POST",
  path: "/users",
});

const optionalUser = struct.object({ id: struct.number() }).optional();
defineRequest({
  builder: (input) => ({ body: input }),
  input: optionalUser,
  method: "POST",
  path: "/users",
});

const unionInput = struct.or(
  struct.object({
    id: struct.number(),
    kind: struct.literal("a"),
    profile: struct.object({ name: struct.string() }),
  }),
  struct.object({ kind: struct.literal("b"), name: struct.string() }),
);
defineRequest({
  builder: (input) => ({ body: input }),
  input: unionInput,
  method: "POST",
  path: "/users",
});
defineRequest({
  // @ts-expect-error a union of objects is not a flat path value
  builder: (input) => ({ path: input }),
  input: unionInput,
  method: "GET",
  path: "/users/:id",
});

const intersectionInput = struct.intersection(
  struct.object({ id: struct.number() }),
  struct.object({ name: struct.string() }),
);
defineRequest({
  builder: (input) => ({ path: input }),
  input: intersectionInput,
  method: "GET",
  path: "/users/:id",
});

defineEventStream({
  // @ts-expect-error SSE defaults to GET and cannot return a body
  builder: () => ({ body: "nope" }),
  events: { message: struct.string() },
  maxBufferSize: 8,
  maxQueueSize: 1,
  path: "/feed",
});

defineEventStream({
  builder: () => ({ body: "ok" }),
  events: { message: struct.string() },
  maxBufferSize: 8,
  maxQueueSize: 1,
  method: "POST",
  path: "/feed",
});

const Profile = struct.object({ name: struct.string() });

type ProfileInput = BuilderInput<typeof Profile>;
type ProfileShape = HttpRequestShape<"/users/:id", "PATCH">;
type SocketShape = WebSocketRequestShape<"/ws/:room">;
type StreamShape = EventStreamRequestShape<"/feed", "GET">;

declare const profile: ProfileInput;
declare const httpShape: ProfileShape;
declare const socketShape: SocketShape;
declare const streamShape: StreamShape;
expectTypeOf(profile).toHaveProperty("name");
expectTypeOf(httpShape).toHaveProperty("body");
expectTypeOf(socketShape).toHaveProperty("query");
expectTypeOf(streamShape).toHaveProperty("headers");

export type Cases = true;
