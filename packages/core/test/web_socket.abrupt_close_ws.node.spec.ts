import { expect, inject, test } from "vitest";
import { WebSocket as NpmWebSocket } from "ws";
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketHandle,
} from "../src";
import { fixture } from "./fixture/client-auto";

// The npm `ws` client reports an abrupt drop as `close` (1006) without a preceding `error`, like Chromium, Firefox and Bun.
test("an injected npm ws handle is classified like the native WebSocket on an abrupt drop", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const base = await f.endpoint("sock", "ws", {
    send: ["1", "2", "3"].map((n) => JSON.stringify({ n: Number(n) })),
  });
  const useSocket = defineWebSocket({
    incoming: struct.object({ n: struct.number() }),
    maxIncomingQueueSize: 8,
    path: "/ws",
  });
  const [error, session] = await useSocket(
    createClient(withEndpoint(base), withWebSocketHandle(NpmWebSocket)),
  );
  expect(error).toBeNull();
  if (!session) throw new Error("expected a socket session");

  await f.act("sock", "terminate");
  const closed = await session.closed;
  expect(closed).toMatchObject({ code: 1006, kind: "error", wasClean: false });

  const delivered: number[] = [];
  let failure: unknown;
  try {
    for await (const message of session.receive) delivered.push(message.n);
  } catch (cause) {
    failure = cause;
  }
  expect(delivered).toEqual([1, 2, 3]);
  expect(failure).toBe(closed.kind === "error" ? closed.cause : undefined);
});
