import { Readable } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
} from "../client";
import { defineRequest } from "../http";
import { defineEventStream } from "../sse";
import { struct } from "../struct";
import { materializeOutboundRequest } from "./outbound_request";

describe("outbound request node bodies", () => {
  test("rejects a Node Readable json body", () => {
    const send = () =>
      materializeOutboundRequest({ body: Readable.from(["x"]) }, "http");

    expect(send).toThrow(TypeError);
    expect(send).toThrow("body is not JSON data: Readable.");
  });

  test("passes a web ReadableStream body through unchanged", () => {
    const fromNode = Readable.toWeb(Readable.from([Buffer.from("x")]));
    const fromAsync = (
      ReadableStream as unknown as {
        from(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array>;
      }
    ).from(
      (async function* () {
        yield new TextEncoder().encode("x");
      })(),
    );

    expect(materializeOutboundRequest({ body: fromNode }, "http").body).toBe(
      fromNode,
    );
    expect(materializeOutboundRequest({ body: fromAsync }, "http").body).toBe(
      fromAsync,
    );
  });

  test("returns REQ_BUILD_FAILED for an HTTP Readable body without calling the handle", async () => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
    );
    const useRequest = defineRequest({
      builder: () => ({ body: Readable.from(["x"]) as never }),
      method: "POST",
      path: "/users",
    });

    const [fault, result, response] = await client.execute(useRequest());

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(
      fault?.cause instanceof TypeError ? fault.cause.message : "",
    ).toMatch(/Readable/);
    expect(handle).toHaveBeenCalledTimes(0);
  });

  test("returns REQ_BUILD_FAILED for an SSE Readable body without calling the handle", async () => {
    const handle = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: a\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
    );
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(handle),
    );
    const useStream = defineEventStream({
      builder: () => ({ body: Readable.from(["x"]) as never }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: "POST",
      path: "/events",
    });

    const [fault, events, open] = await client.execute(useStream());

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(events).toBeUndefined();
    expect(open).toBeUndefined();
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(
      fault?.cause instanceof TypeError ? fault.cause.message : "",
    ).toMatch(/Readable/);
    expect(handle).toHaveBeenCalledTimes(0);
  });
});
