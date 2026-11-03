import { createServer } from "node:http";
import { expect, inject, test } from "vitest";
import {
  ERR_NO_ENDPOINT,
  createClient,
  createHttpInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withEndpointBalancer,
  withInterceptors,
  withSSEReconnect,
} from "../src";
import type {
  EndpointBalancer,
  EndpointDoneInfo,
  EndpointPickInfo,
} from "../src";

function refusedUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a TCP port"));
        return;
      }
      const url = `http://127.0.0.1:${address.port}`;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(url);
      });
    });
  });
}

function recordingBalancer(): {
  balancer: EndpointBalancer;
  dones: EndpointDoneInfo[];
  picks: string[];
} {
  const picks: string[] = [];
  const dones: EndpointDoneInfo[] = [];
  const balancer: EndpointBalancer = {
    pick(info: EndpointPickInfo) {
      const endpoint = info.endpoints[0];
      if (endpoint === undefined) {
        return [ERR_NO_ENDPOINT, undefined];
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

test("default GET fails over to the fixture within the same call", async () => {
  const refused = await refusedUrl();
  const fixture = inject("testServerHost");
  const seen: string[] = [];
  const client = createClient(
    withEndpoint(refused, fixture),
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
    withEndpointBalancer(recorded.balancer),
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
  } finally {
    await iterator.return?.();
  }
});

test("re-picks on reconnect and reports the opened attempt once", async () => {
  const fixture = inject("testServerHost");
  const recorded = recordingBalancer();
  const client = createClient(
    withEndpoint(fixture),
    withEndpointBalancer(recorded.balancer),
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
  expect(recorded.dones).toEqual([{ attempted: true }]);

  socket.close(1000, "done");
  await socket.closed;
});

test("health filtering attributes each same-call failover attempt to its own endpoint", async () => {
  const { outlierDetection } = await import("../src");
  const refused = await refusedUrl();
  const fixture = inject("testServerHost");
  const samples: { endpoint: string; report: EndpointDoneInfo }[] = [];
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
    withEndpoint(refused, fixture),
    withEndpointBalancer(balancer),
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

test("default round robin stops routing a persistent 503 replica after five failures", async () => {
  const { roundRobinBalancer, withEndpointFailover } = await import("../src");
  const fixture = inject("testServerHost");
  const good = `${fixture}/balancer/good`;
  const bad = `${fixture}/balancer/bad`;
  const hits: string[] = [];
  const client = createClient(
    withEndpoint(bad, good),
    withEndpointBalancer(roundRobinBalancer()),
    withEndpointFailover({ attempts: 0 }),
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
