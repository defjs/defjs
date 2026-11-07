import type { ServerWebSocket } from "bun";
import { expect, inject, test } from "vitest";
import {
  ERR_NO_CANDIDATE,
  createClient,
  createHttpInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withRetry,
  withBalancer,
  pickFirstBalancer,
  withInterceptors,
  withSSEReconnect,
} from "../src";
import type { Balancer, DoneInfo, PickInfo } from "../src";

async function refusedUrl(): Promise<string> {
  const server = Bun.serve({
    fetch: () => new Response(null),
    hostname: "127.0.0.1",
    port: 0,
  });
  const { port } = server;
  await server.stop(true);
  return `http://127.0.0.1:${port}`;
}

function recordingBalancer(): {
  balancer: Balancer;
  dones: DoneInfo[];
  picks: string[];
} {
  const picks: string[] = [];
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick(info: PickInfo) {
      const endpoint = info.endpoints[0];
      if (endpoint === undefined) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      picks.push(endpoint);
      return [
        null,
        {
          endpoint,
          done(doneInfo) {
            dones.push(doneInfo);
          },
        },
      ];
    },
  };
  return { balancer, dones, picks };
}

test("opted-in GET fails over to the fixture within the same call", async () => {
  const refused = await refusedUrl();
  const fixture = inject("testServerHost");
  const seen: string[] = [];
  const client = createClient(
    withEndpoint(refused, fixture),
    withBalancer(pickFirstBalancer()),
    withRetry({ delayMs: 0 }),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        const endpoint = request.baseEndpoint;
        if (endpoint === undefined) {
          throw new Error("expected a selected endpoint");
        }
        seen.push(endpoint);
        return await next(request);
      }),
    ),
  );
  const readJson = defineRequest({
    method: "GET",
    output: struct.object({ id: struct.number() }),
    path: "/json",
  });

  const [first] = await readJson(client);
  const [second, body] = await readJson(client);

  expect(first).toBeNull();
  expect(second).toBeNull();
  expect(body).toEqual({ id: 1 });
  expect(seen).toEqual([refused, fixture, fixture]);
});

test("re-picks after an event-stream read failure and the next attempt hits the fixture", async () => {
  const fixture = inject("testServerHost");
  const recorded = recordingBalancer();
  const client = createClient(
    withEndpoint(fixture),
    withBalancer(recorded.balancer),
    withSSEReconnect({ attempts: 1, delayMs: 0 }),
  );
  const useDrop = defineEventStream({
    builder: (input) => ({ query: input }),
    events: { message: struct.string() },
    input: struct.object({ key: struct.string() }),
    path: "/sse/drop",
  });
  const key = `drop-${crypto.randomUUID()}`;

  const [error, stream] = await useDrop(client, { key });
  expect(error).toBeNull();
  if (!stream) {
    throw new Error("expected an event stream");
  }

  const iterator = stream[Symbol.asyncIterator]();
  try {
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: "partial", event: "message", id: "1" },
    });

    const cut = await fetch(
      `${fixture}/sse/drop/cut?key=${encodeURIComponent(key)}`,
      { method: "POST" },
    );
    expect(cut.status).toBe(204);

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: "resumed", event: "message", id: "2" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(recorded.picks).toEqual([fixture, fixture]);
    expect(await stream.closed).toEqual({ kind: "eof" });
    expect(recorded.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: true, status: 200 },
    ]);
  } finally {
    await iterator.return?.();
  }
});

test("re-picks on reconnect and reports the opened attempt once", async () => {
  const fixture = inject("testServerHost");
  const recorded = recordingBalancer();
  const client = createClient(
    withEndpoint(fixture),
    withBalancer(recorded.balancer),
  );
  const useSocket = defineWebSocket({
    builder: (input) => ({ query: input }),
    incoming: struct.object({
      attempt: struct.number(),
      type: struct.literal("reconnected"),
    }),
    input: struct.object({ key: struct.string() }),
    maxIncomingQueueSize: 16,
    path: "/ws/reconnect",
  });
  const key = `balancer-${crypto.randomUUID()}`;

  const [error, socket] = await useSocket(
    client({ reconnect: { attempts: 1, delayMs: 0 } }),
    { key },
  );
  expect(error).toBeNull();
  if (!socket) {
    throw new Error("expected a socket");
  }

  const iterator = socket.receive[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: { attempt: 2, type: "reconnected" },
  });
  expect(recorded.picks).toEqual([fixture, fixture]);
  expect(recorded.dones).toEqual([
    { attempted: true, code: "NET_UNAVAILABLE" },
  ]);

  socket.close(1000, "done");
  await socket.closed;
});

test("default pick-first recovers from a real socket disconnect after consuming a message", async () => {
  const firstPeer = Promise.withResolvers<ServerWebSocket<unknown>>();
  const hits: string[] = [];
  const primary = Bun.serve({
    fetch(request, server) {
      server.upgrade(request);
      return undefined;
    },
    hostname: "127.0.0.1",
    port: 0,
    websocket: {
      open(socket) {
        hits.push("primary");
        firstPeer.resolve(socket);
        socket.send(JSON.stringify("primary"));
      },
    },
  });
  const secondary = Bun.serve({
    fetch(request, server) {
      server.upgrade(request);
      return undefined;
    },
    hostname: "127.0.0.1",
    port: 0,
    websocket: {
      open(socket) {
        hits.push("secondary");
        socket.send(JSON.stringify("secondary"));
      },
    },
  });
  try {
    const endpoints = [primary.port, secondary.port].map(
      (port) => `http://127.0.0.1:${port}`,
    );
    const client = createClient(withEndpoint(...endpoints));
    const useSocket = defineWebSocket({
      incoming: struct.string(),
      maxIncomingQueueSize: 4,
      path: "/ws",
    });
    const [error, session] = await useSocket(
      client({ reconnect: { attempts: 1, delayMs: 0 } }),
    );
    expect(error).toBeNull();
    if (!session) throw new Error("expected a socket session");
    try {
      const iterator = session.receive[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: "primary",
      });
      (await firstPeer.promise).terminate();
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: "secondary",
      });
      expect(hits).toEqual(["primary", "secondary"]);
      expect(session.connection?.generation).toBe(2);
    } finally {
      await session[Symbol.asyncDispose]();
    }
  } finally {
    await Promise.all([primary.stop(true), secondary.stop(true)]);
  }
});

test("health filtering attributes each same-call failover attempt to its own endpoint", async () => {
  const { outlierDetection } = await import("../src");
  const refused = await refusedUrl();
  const fixture = inject("testServerHost");
  const samples: { endpoint: string; report: DoneInfo }[] = [];
  const choices: string[][] = [];
  let selected = "";
  const balancer = outlierDetection(
    {
      pick(info) {
        choices.push([...info.endpoints]);
        selected = info.endpoints[0] ?? "";
        return [null, { endpoint: selected }];
      },
    },
    {
      consecutiveFailures: 1,
      isFailure(report) {
        samples.push({ endpoint: selected, report });
        return report.code === "NET_UNREACHABLE";
      },
    },
  );
  const client = createClient(
    withRetry({ delayMs: 0 }),
    withEndpoint(refused, fixture),
    withBalancer(balancer),
  );
  const get = defineRequest({
    method: "GET",
    path: "/json",
    output: struct.object({ id: struct.number() }),
  });
  expect((await get(client))[0]).toBeNull();
  expect((await get(client))[0]).toBeNull();
  expect(samples.map(({ endpoint }) => endpoint)).toEqual([
    refused,
    fixture,
    fixture,
  ]);
  expect(samples[0]?.report).toEqual({
    attempted: true,
    code: "NET_UNREACHABLE",
  });
  expect(samples[1]?.report).toMatchObject({ attempted: true, status: 200 });
  expect(choices).toEqual([[refused, fixture], [fixture], [fixture]]);
});

test("health-filtered round robin stops routing a persistent 503 replica after five failures", async () => {
  const { roundRobinBalancer } = await import("../src");
  const fixture = inject("testServerHost");
  const good = `${fixture}/balancer/good`;
  const bad = `${fixture}/balancer/bad`;
  const hits: string[] = [];
  const client = createClient(
    withEndpoint(bad, good),
    // A penalty longer than the test keeps the ejected replica out regardless of machine speed.
    withBalancer(
      roundRobinBalancer({
        outlierDetection: {
          minPenaltyMs: 60_000,
          maxPenaltyMs: 60_000,
          jitterRatio: 0,
        },
      }),
    ),

    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        hits.push(request.baseEndpoint ?? "");
        return next(request);
      }),
    ),
  );
  const read = defineRequest({ method: "GET", path: "/replica" });
  for (let i = 0; i < 13; i += 1) await read(client);
  expect(hits.filter((endpoint) => endpoint === bad)).toHaveLength(5);
  expect(hits.slice(-3)).toEqual([good, good, good]);
});
