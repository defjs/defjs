// Browser-only workloads, bundled once per core source next to ../scenarios.mjs (run.mjs replaces `__CORE__` in both, like bench.sh).
import {
  createClient,
  defineEventStream,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
} from "__CORE__";
import { scenarios as shared } from "./scenarios.gen.mjs";

const check = (result) => {
  if (result[0] !== null) throw result[0];
  return result;
};
const expectOk = (result) => {
  if (result[0]) throw result[0];
};
const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  email: struct.string(),
  active: struct.boolean(),
  createdAt: struct.string().alias("created_at"),
});

// ---- real network ------------------------------------------------------------------------------
// No custom handle, so the browser's own fetch talks to the server in run.mjs, which answers with the payloads of get-small / get-list-1000.
const getUser = defineRequest({
  builder: (input) => ({ path: input }),
  input: struct.object({ id: struct.number() }),
  method: "GET",
  output: User,
  path: "/users/:id",
});
const listUsers = defineRequest({
  method: "GET",
  output: struct.array(User),
  path: "/users",
});
const network = createClient(withEndpoint(location.origin));

export const scenarios = {
  ...shared,
  "net-get-small": async () => check(await network.execute(getUser({ id: 1 }))),
  "net-get-list": async () => check(await network.execute(listUsers())),
};

// ---- retained heap (same workloads and rounds as ../leak.mjs) ----------------------------------
const json = JSON.stringify({ id: 1, name: "Ada" });
const http = createClient(
  withEndpoint("https://api.example.com"),
  withHTTPHandle(() =>
    Promise.resolve(
      new Response(json, { headers: { "content-type": "application/json" } }),
    ),
  ),
);
const get = defineRequest({
  method: "GET",
  path: "/u",
  output: struct.object({ id: struct.number(), name: struct.string() }),
});
const payload = new TextEncoder().encode('event: tick\ndata: {"seq":1}\n\n');
const sse = createClient(
  withEndpoint("https://api.example.com"),
  withSSEHandle(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(payload);
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    ),
  ),
);
const feed = defineEventStream({
  events: { tick: struct.object({ seq: struct.number() }) },
  maxBufferSize: 65536,
  maxQueueSize: 16,
  path: "/feed",
});

// `rounds` are increments: [20000, 40000] is reported after 20000 and after 60000 requests in total.
export const leaks = {
  "http { signal }": {
    rounds: [20000, 40000],
    once: async (signal) => expectOk(await http.execute(get(), { signal })),
  },
  "http { signal, timeout }": {
    rounds: [20000, 40000],
    once: async (signal) =>
      expectOk(await http.execute(get(), { signal, timeout: 60000 })),
  },
  "http { timeout }": {
    rounds: [20000, 40000],
    once: async () => expectOk(await http.execute(get(), { timeout: 60000 })),
  },
  "sse { signal }": {
    rounds: [5000, 10000],
    once: async (signal) => {
      const [error, stream] = await sse.execute(feed(), { signal });
      if (error) throw error;
      for await (const _event of stream);
    },
  },
};

// ---- retained heap per decoded object: 5 lists of 10k get-list-1000 items, kept alive ----------
const ListStruct = struct.array(User);
const kept = [];
let input;
const decodeOnce = () =>
  check(struct.parse(ListStruct, input, { aliases: true }))[1];

export const decode = {
  lists: 5,
  size: 10_000,
  // Decoding twice first puts compiled code and caches in place, so they are not counted as retained objects.
  prepare() {
    input = Array.from({ length: decode.size }, (_, i) => ({
      id: i,
      name: `n${i}`,
      email: `u${i}@x.io`,
      active: i % 2 === 0,
      created_at: "2026-01-01",
    }));
    decodeOnce();
    decodeOnce();
  },
  keep() {
    for (let i = 0; i < decode.lists; i += 1) kept.push(decodeOnce());
  },
};
