import { expect, inject, test } from "vitest";
import { createClient, defineWebSocket, struct, withEndpoint } from "../src";
import { fixture } from "./fixture/client-auto";

test("an abrupt drop without a close frame is an error and keeps the messages already received", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const base = await f.endpoint("sock", "ws", {
    send: ["1", "2", "3", "4", "5"].map((n) =>
      JSON.stringify({ n: Number(n) }),
    ),
  });
  const useSocket = defineWebSocket({
    incoming: struct.object({ n: struct.number() }),
    path: "/ws",
  });
  const [error, session] = await useSocket(createClient(withEndpoint(base)));
  expect(error).toBeNull();
  if (!session) throw new Error("expected a socket session");

  await f.act("sock", "terminate");
  // Settle first, then read: the frames are queued before the consumer asks for any of them.
  const closed = await session.closed;
  expect(closed).toMatchObject({ code: 1006, kind: "error", wasClean: false });

  const delivered: number[] = [];
  let failure: unknown;
  try {
    for await (const message of session.receive) delivered.push(message.n);
  } catch (cause) {
    failure = cause;
  }
  expect(delivered).toEqual([1, 2, 3, 4, 5]);
  expect(failure).toBe(closed.kind === "error" ? closed.cause : undefined);
});
