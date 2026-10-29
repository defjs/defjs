import { expect, inject, test } from "vitest";
import { createClient, defineEventStream, struct, withEndpoint } from "../src";

test("sends builder path, query, headers, and body, and decodes string and JSON SSE events", async () => {
  const client = createClient(withEndpoint(inject("testServerHost")));
  const useFeed = defineEventStream({
    builder: (input) => ({
      body: input.note,
      headers: input.trace,
      path: input.room,
      query: input.cursor,
    }),
    events: {
      meta: struct.object({
        body: struct.string(),
        rawQuery: struct.string(),
        room: struct.string(),
        traceId: struct.string().alias("trace_id"),
      }),
      note: struct.string(),
    },
    input: struct.object({
      cursor: struct.object({
        since: struct.string().alias("since_ts"),
      }),
      note: struct.string(),
      room: struct.object({
        roomId: struct.string().alias("room"),
      }),
      trace: struct.object({
        traceId: struct.string().alias("x-trace-id"),
      }),
    }),
    maxBufferSize: 64 * 1024,
    maxQueueSize: 8,
    method: "POST",
    path: "/e2e/sse/:room",
  });

  const [error, stream] = await client.execute(
    useFeed({
      cursor: { since: "5" },
      note: "hello note",
      room: { roomId: "blue" },
      trace: { traceId: "tid" },
    }),
  );

  expect(error).toBeNull();
  if (!stream) {
    throw new Error("Expected an event stream");
  }

  const events = [];
  for await (const event of stream) {
    events.push(event);
  }

  expect(events).toEqual([
    { data: "plain-from-server", event: "note", id: "1" },
    {
      data: {
        body: "hello note",
        rawQuery: "since_ts=5",
        room: "blue",
        traceId: "tid",
      },
      event: "meta",
      id: "2",
    },
  ]);
});
