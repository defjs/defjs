import { describe, expect, test } from "vitest";
import { materializeOutboundRequest } from "./outbound_request";

class NonJsonBody {
  readonly value = "x";
}

function streamFrom(
  source: AsyncIterable<Uint8Array>,
): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
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
});
