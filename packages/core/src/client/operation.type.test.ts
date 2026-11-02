/**
 * Type acceptance for the callable client and operation functions.
 * Ported from docs/design/2026-11-01-operation-client.type.test.ts.
 */
import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  type Client,
  type EventStreamData,
  type HttpAwaitResult,
  type RequestOptions,
  type StreamAwaitResult,
} from "../index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

const client = createClient(withEndpoint("https://example.test"));
const signal = new AbortController().signal;

const derived: Client = client({ signal });
const noOptions: Client = client();
void [derived, noOptions];
// @ts-expect-error A derived client is not callable.
client({ signal })({ protocols: ["chat.v1"] })();

// @ts-expect-error timeout was removed from request options.
client({ timeout: 100 });
// @ts-expect-error abort was renamed; cancellation is signal.
client({ abort: signal });
// @ts-expect-error Client has no public execute member.
void client.execute;

export type OptionKeys = Expect<
  Equal<
    keyof RequestOptions,
    | "signal"
    | "onUploadProgress"
    | "onDownloadProgress"
    | "beforeConnect"
    | "protocols"
    | "heartbeat"
    | "reconnect"
  >
>;

export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});
export const health = defineRequest({ method: "GET", path: "/health" });
export const search = defineRequest({
  method: "GET",
  path: "/search",
  input: struct.object({ q: struct.string().optional() }).optional(),
  builder: (input) => ({ query: input ?? {} }),
});

getUser(client, { id: 1 });
getUser(client({ signal }), { id: 1 });
health(client);
health(client({ signal }));
search(client);
search(client({ signal }), { q: "Ada" });

// @ts-expect-error an operation with no input does not accept a second argument.
health(client, { signal });
// @ts-expect-error operations do not accept a third options argument.
getUser(client, { id: 1 }, { signal });
// @ts-expect-error a required input cannot be omitted.
getUser(client({ signal }));
// @ts-expect-error the input value must match the struct.
getUser(client({ signal }), { id: "wrong" });
// @ts-expect-error the old endpoint(input) entry is rejected; the first argument is a Client.
getUser({ id: 1 });

getUser(client({ protocols: ["chat.v1"] }), { id: 1 });

export const updates = defineEventStream({
  path: "/events",
  events: { message: struct.object({ text: struct.string() }) },
});
const Incoming = struct.object({
  type: struct.literal("pong"),
  count: struct.number(),
});
const Outgoing = struct.object({ type: struct.literal("ping") });
export const room = defineWebSocket({
  path: "/room",
  incoming: Incoming,
  outgoing: Outgoing,
  maxIncomingQueueSize: 10,
});
const shared = client({ signal });
getUser(shared, { id: 1 });
health(shared);
updates(shared);
room(shared);

room(
  client({
    heartbeat: {
      intervalMs: 1000,
      timeoutMs: 100,
      message: () => ({ type: "ping" }),
      isAck: (message) => {
        // @ts-expect-error heartbeat messages are unknown and are not inferred from the operation.
        return message.type === "pong";
      },
    },
  }),
);
room(
  client({
    heartbeat: {
      intervalMs: 1000,
      isAck: (message) =>
        typeof message === "object" && message !== null && "count" in message,
    },
  }),
);

// @ts-expect-error a misspelled field is not a request option.
client({ signla: signal });
// @ts-expect-error excess properties of an object literal are rejected.
client({ signal, applicationExtra: true });
const saved = { signal, applicationExtra: true };
client(saved);

async function result() {
  const [error, user, response] = await getUser(client({ signal }), { id: 1 });
  if (error) {
    // @ts-expect-error the error branch cannot read the success value.
    void user.name;
    if (error.code === "HTTP_STATUS") {
      const message: string = error.data.message;
      void message;
    }
    return;
  }
  const id: number = user.id;
  const name: string = user.name;
  const status: number = response.status;
  void [id, name, status];
}
void result;

async function resources() {
  const [streamError, stream] = await updates(client({ signal }));
  if (streamError) return;
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    const text: string = event.data.text;
    void text;
    break;
  }
  const [socketError, session] = await room(client({ signal }));
  if (socketError) return;
  await using ownedSession = session;
  ownedSession.send({ type: "ping" });
  // @ts-expect-error session send arguments must match the outgoing struct.
  ownedSession.send({ type: "pong" });
  for await (const message of ownedSession.receive) {
    const count: number = message.count;
    void count;
    break;
  }
}
void resources;

export type UserInput = Expect<
  Equal<Parameters<typeof getUser>[1], { id: number }>
>;
export type UserResult = Expect<
  Equal<
    Exclude<Awaited<ReturnType<typeof getUser>>[1], undefined>,
    { id: number; name: string }
  >
>;

const StreamEvents = { message: struct.object({ text: struct.string() }) };
const Problem = struct.object({ message: struct.string() }).optional();
const optionalErrorStream = defineEventStream({
  path: "/error-stream",
  events: StreamEvents,
  error: Problem,
});
const httpCompatible: Expect<
  Equal<
    ReturnType<typeof getUser>,
    Promise<HttpAwaitResult<{ id: number; name: string }, { message: string }>>
  >
> = true;
const streamCompatible: Expect<
  Equal<
    ReturnType<typeof optionalErrorStream>,
    Promise<
      StreamAwaitResult<EventStreamData<typeof StreamEvents>, typeof Problem>
    >
  >
> = true;
void [httpCompatible, streamCompatible];

// @ts-expect-error a declared input still requires a builder.
defineRequest({
  method: "GET",
  path: "/missing",
  input: struct.object({ id: struct.number() }),
});
defineRequest({
  method: "GET",
  path: "/invalid",
  // @ts-expect-error GET cannot send a body.
  builder: () => ({ body: "bad" }),
});
