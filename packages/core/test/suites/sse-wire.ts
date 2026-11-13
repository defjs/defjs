import { resolveRetryPolicy } from "../../src/internal/retry.ts";
import { expect, inject, test } from "vitest";
import { DEFAULT_FETCH } from "../../src/client/config.ts";
import { startEventStream } from "../start-event-stream.ts";
import type { EventStreamMessage } from "../../src/sse/transport/parser.ts";
import { fixture } from "../fixture/client-auto.ts";

function concatBytes(
  left: Uint8Array,
  right: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

export function registerSseWireSuite(): void {
  test.each([
    ["猫", [0xe7, 0x8c, 0xab]],
    ["été", [0xc3, 0xa9, 0x74, 0xc3, 0xa9]],
  ])(
    "should send UTF-8 Last-Event-ID bytes on the wire for %s",
    async (id, expectedBytes) => {
      const f = fixture(inject("testServerHost"), inject("fixtureToken"));
      await f.endpoint("anchor", "hang", {});
      const baseEndpoint = f.rawUrl(
        inject("rawServerOrigin"),
        "utf8-last-event-id",
      );
      const firstSeen = Promise.withResolvers<void>();
      const dropped = firstSeen.promise.then(() =>
        f.act("raw:utf8-last-event-id", "drop"),
      );
      const stream = await startEventStream(
        {
          baseEndpoint,
          endpoint: `/events/${encodeURIComponent(id)}`,
          method: "GET",
        },
        {
          fetch: DEFAULT_FETCH,
          maxBufferSize: 1024,
          retry: resolveRetryPolicy({ maxRetries: 1, delayMs: 0 }),
          transformMessage(message) {
            firstSeen.resolve();
            return message;
          },
        },
      );
      const messages: string[] = [];
      for await (const message of stream) messages.push(message.data);
      await dropped;

      expect(messages).toEqual(["first", "second"]);
      const { requests } = await f.log({ wait: 2 });
      expect(requests).toHaveLength(2);
      const header = /\r\nlast-event-id: ([^\r\n]*)\r\n/i.exec(
        requests[1]?.rawHead ?? "",
      )?.[1];
      expect(header).toBeDefined();
      if (header === undefined) {
        throw new Error("Expected Last-Event-ID on the wire");
      }
      expect([...header].map((character) => character.charCodeAt(0))).toEqual(
        expectedBytes,
      );
      await expect(stream.closed).resolves.toEqual({ kind: "eof" });
    },
  );

  test("should reconnect from the committed id after a partial id frame is cut", async () => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    await f.endpoint("anchor", "hang", {});
    const baseEndpoint = f.rawUrl(
      inject("rawServerOrigin"),
      "partial-frame-resume",
    );
    const partial = "id: 1\ndata: first\n\nid: 2\n";
    let calls = 0;
    const stream = await startEventStream(
      {
        baseEndpoint,
        endpoint: "/events",
        method: "GET",
      },
      {
        maxBufferSize: 1024,
        transformMessage: (message) => message,
        retry: resolveRetryPolicy({ maxRetries: 1, delayMs: 0 }),
        async fetch(input, init) {
          const response = await globalThis.fetch(input, init);
          if (++calls !== 1) return response;
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Expected response body");
          const partialBytes = new TextEncoder().encode(partial);
          let forwarded = false;
          return new Response(
            new ReadableStream<Uint8Array>(
              {
                async pull(controller) {
                  if (forwarded) {
                    // Zero prefetch: this pull proves the parser consumed the partial id line.
                    await f.act("raw:partial-frame-resume", "terminate");
                    await reader.read();
                    return;
                  }
                  let bytes = new Uint8Array();
                  while (bytes.byteLength < partialBytes.byteLength) {
                    const result = await reader.read();
                    if (result.done) throw new Error("Expected partial frame");
                    bytes = concatBytes(bytes, result.value);
                  }
                  forwarded = true;
                  controller.enqueue(bytes);
                },
                cancel(reason) {
                  return reader.cancel(reason);
                },
              },
              { highWaterMark: 0 },
            ),
            { headers: response.headers },
          );
        },
      },
    );
    const messages: EventStreamMessage[] = [];
    for await (const message of stream) messages.push(message);

    const { requests } = await f.log({ wait: 2 });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.rawHead).toMatch(/\r\nlast-event-id: 1\r\n/i);
    expect(messages.map((message) => message.id)).toEqual(["1", "2"]);
    expect(messages.map((message) => message.data)).toEqual([
      "first",
      "second",
    ]);
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });
}
