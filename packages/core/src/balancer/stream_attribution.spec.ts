import { expect, inject, test } from "vitest";
import { createClient, withBalancer, withEndpoint } from "../client";
import { withSSEReconnect } from "../client/option";
import { defineEventStream } from "../sse";
import { struct } from "../struct";
import { defineWebSocket } from "../web_socket";
import type { Balancer, DoneInfo } from "./balancer";
import { ERR_NO_CANDIDATE } from "./balancer";

function recording(): { balancer: Balancer; dones: DoneInfo[] } {
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick(info) {
      const endpoint = info.endpoints[0];
      if (endpoint === undefined) return [ERR_NO_CANDIDATE, undefined];
      return [null, { endpoint, done: (report) => dones.push(report) }];
    },
  };
  return { balancer, dones };
}

test("a WebSocket closed with 1012 after open reports NET_UNAVAILABLE in a real engine", async () => {
  const fixture = inject("testServerHost");
  const recorded = recording();
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
    outgoing: struct.object({
      text: struct.string(),
      type: struct.literal("message"),
    }),
    path: "/ws/reconnect",
  });
  const [error, socket] = await useSocket(
    client({ reconnect: { attempts: 1, delayMs: 0 } }),
    { key: `attribution-${crypto.randomUUID()}` },
  );
  expect(error).toBeNull();
  if (!socket) throw new Error("expected a socket");

  socket.send({ text: "seen-open", type: "message" });
  const iterator = socket.receive[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: { attempt: 2, type: "reconnected" },
  });
  expect(recorded.dones).toEqual([
    { attempted: true, code: "NET_UNAVAILABLE" },
  ]);
  socket.close(1000, "done");
  await socket.closed;
});

test("an unanswered WebSocket heartbeat reports NET_UNREACHABLE in a real engine", async () => {
  const recorded = recording();
  const client = createClient(
    withEndpoint(inject("testServerHost")),
    withBalancer(recorded.balancer),
  );
  const useSocket = defineWebSocket({
    incoming: struct.object({ type: struct.literal("pong") }),
    maxIncomingQueueSize: 16,
    outgoing: struct.object({ type: struct.literal("ping") }),
    path: "/ws/heartbeat-silent",
  });
  const [error, socket] = await useSocket(
    client({
      heartbeat: {
        intervalMs: 50,
        message: () => ({ type: "ping" as const }),
        timeoutMs: 100,
      },
    }),
  );
  expect(error).toBeNull();
  if (!socket) throw new Error("expected a socket");

  expect((await socket.closed).kind).toBe("error");
  expect(recorded.dones).toEqual([
    { attempted: true, code: "NET_UNREACHABLE" },
  ]);
});

test("an event stream whose body read fails reports NET_UNREACHABLE in a real engine", async () => {
  const fixture = inject("testServerHost");
  const recorded = recording();
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
  const key = `attribution-${crypto.randomUUID()}`;
  const [error, stream] = await useDrop(client, { key });
  expect(error).toBeNull();
  if (!stream) throw new Error("expected an event stream");

  const iterator = stream[Symbol.asyncIterator]();
  try {
    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: "partial" },
    });
    const cut = await fetch(
      `${fixture}/sse/drop/cut?key=${encodeURIComponent(key)}`,
      { method: "POST" },
    );
    expect(cut.status).toBe(204);
    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: "resumed" },
    });
    expect(recorded.dones[0]).toEqual({
      attempted: true,
      code: "NET_UNREACHABLE",
    });
  } finally {
    await stream[Symbol.asyncDispose]();
  }
});
