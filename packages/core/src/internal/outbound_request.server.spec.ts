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

class NonJsonBody {
  readonly value = "x";
}

function readUnknown(value: unknown): unknown {
  return value;
}

function streamFrom(source: AsyncIterable<Uint8Array>): ReadableStream {
  const from = readUnknown(Reflect.get(ReadableStream, "from"));
  if (typeof from !== "function") {
    throw new Error("ReadableStream.from is unavailable");
  }
  const stream = readUnknown(Reflect.apply(from, ReadableStream, [source]));
  if (!(stream instanceof ReadableStream)) {
    throw new Error("expected a ReadableStream");
  }
  return stream;
}

describe("outbound request non-JSON bodies", () => {
  test("rejects a class instance json body", () => {
    const send = () =>
      materializeOutboundRequest({ body: new NonJsonBody() }, "http");

    expect(send).toThrow(TypeError);
    expect(send).toThrow("body is not JSON data: NonJsonBody.");
  });

  test("passes a web ReadableStream body through unchanged", () => {
    const fromAsync = streamFrom(
      (async function* () {
        yield await Promise.resolve(new TextEncoder().encode("x"));
      })(),
    );

    expect(materializeOutboundRequest({ body: fromAsync }, "http").body).toBe(
      fromAsync,
    );
  });

  test("returns REQ_BUILD_FAILED for an HTTP class-instance body without calling the handle", async () => {
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
    );
    const useRequest = defineRequest({
      // @ts-expect-error a class instance is not a fetch body
      builder: () => ({
        body: new NonJsonBody(),
      }),
      method: "POST",
      path: "/users",
    });

    const [fault, result, response] = await useRequest(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(
      fault?.cause instanceof TypeError ? fault.cause.message : "",
    ).toMatch(/NonJsonBody/);
    expect(handle).toHaveBeenCalledTimes(0);
  });

  test("returns REQ_BUILD_FAILED for an SSE class-instance body without calling the handle", async () => {
    const handle = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: a\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ),
    );
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(handle),
    );
    const useStream = defineEventStream({
      // @ts-expect-error a class instance is not a fetch body
      builder: () => ({
        body: new NonJsonBody(),
      }),
      events: { message: struct.string() },
      method: "POST",
      path: "/events",
    });

    const [fault, events, open] = await useStream(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(events).toBeUndefined();
    expect(open).toBeUndefined();
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(
      fault?.cause instanceof TypeError ? fault.cause.message : "",
    ).toMatch(/NonJsonBody/);
    expect(handle).toHaveBeenCalledTimes(0);
  });
});
