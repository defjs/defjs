import { expect, inject, test } from "vitest";
import { createClient, defineWebSocket, struct, withEndpoint } from "../src";

test("sends builder path and query, decodes discriminated incoming frames, and the server observes aliased outgoing JSON", async () => {
  const client = createClient(withEndpoint(inject("testServerHost")));
  const useChat = defineWebSocket({
    builder: (input) => ({
      path: input.room,
      query: input.cursor,
    }),
    incoming: struct.discriminatedUnion("type", [
      struct.object({
        query: struct.string(),
        roomId: struct.string().alias("room_id"),
        type: struct.literal("joined"),
      }),
      struct.object({
        raw: struct.string(),
        type: struct.literal("observed"),
      }),
    ]),
    input: struct.object({
      cursor: struct.object({
        since: struct.string().alias("since_ts"),
      }),
      room: struct.object({
        roomId: struct.string().alias("room"),
      }),
    }),
    maxIncomingQueueSize: 4,
    outgoing: struct.discriminatedUnion("type", [
      struct.object({
        type: struct.literal("say"),
        text: struct.string().alias("message_text"),
      }),
      struct.object({
        type: struct.literal("ping"),
      }),
    ]),
    path: "/e2e/ws/:room",
  });

  const [error, socket] = await client.execute(
    useChat({
      cursor: { since: "5" },
      room: { roomId: "blue" },
    }),
  );

  expect(error).toBeNull();
  if (!socket) {
    throw new Error("Expected a WebSocket session");
  }

  try {
    const iterator = socket.receive[Symbol.asyncIterator]();
    const joined = await iterator.next();
    if (joined.done) {
      throw new Error("Expected a joined frame");
    }

    socket.send({ text: "hi", type: "say" });

    const observed = await iterator.next();
    if (observed.done) {
      throw new Error("Expected the server to observe the outgoing frame");
    }

    expect(joined.value).toEqual({
      query: "since_ts=5",
      roomId: "blue",
      type: "joined",
    });
    expect(observed.value).toEqual({
      raw: '{"type":"say","message_text":"hi"}',
      type: "observed",
    });
  } finally {
    socket.close();
    await socket.closed;
  }
});
