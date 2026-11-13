import { describe, expect, test } from "vitest";
import {
  createClient,
  type DerivableClient,
  withEndpoint,
  withInterceptors,
  withWebSocketBeforeConnect,
  withWebSocketHandle,
} from "../client";
import {
  createHttpStatusFault,
  createUndecodedHttpStatusFault,
} from "../error";
import { createWebSocketInterceptor } from "../interceptor";
import { struct } from "../struct";
import { createFakeWebSocket, FakeWebSocket } from "../../test/fake_web_socket";
import { defineWebSocket } from "./index";

/**
 * Locks WebSocket onto the one fault-code namespace shared with HTTP and SSE.
 *
 * The startup catch used to cast whatever it caught straight to `RequestError`, so a plain
 * `Error` from an interceptor crossed the public boundary with no discriminant at all. That
 * catch is also the funnel for every other startup failure, so classifying it needs a guard:
 * replacing it unconditionally would report a refused connection as an interceptor fault.
 */

const useRoom = defineWebSocket({
  incoming: struct.object({
    type: struct.literal("message"),
    text: struct.string(),
  }),
  path: "/ws",
});

function unreachableClient(
  ...options: Parameters<typeof createClient>
): DerivableClient {
  return createClient(withEndpoint("http://127.0.0.1:1"), ...options);
}

describe("web socket startup faults", () => {
  test.each(["abort", "timeout"] as const)(
    "should classify a pre-cancelled interceptor signal as %s without constructing a socket",
    async (mode) => {
      const fake = createFakeWebSocket();
      const client = createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(fake.Socket),
        withInterceptors(
          createWebSocketInterceptor((request, next) =>
            next({
              ...request,
              signal: AbortSignal.abort(
                mode === "timeout"
                  ? new DOMException("deadline", "TimeoutError")
                  : "stop",
              ),
            }),
          ),
        ),
      );

      const [fault, session] = await useRoom(client);

      expect(fake.sockets).toHaveLength(0);
      expect(session).toBeUndefined();
      expect(fault?.code).toBe(
        mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
      );
    },
  );

  test("should return a thrown HTTP fault unchanged, with or without a decoded body", async () => {
    const meta = {
      headers: new Headers(),
      ok: false,
      status: 503,
      statusText: "unavailable",
      url: "https://example.test/ws",
    };
    const undecoded = createUndecodedHttpStatusFault(meta);
    const decoded = createHttpStatusFault({
      ...meta,
      body: { reason: "down" },
    });
    for (const thrown of [undecoded, decoded]) {
      const client = createClient(
        withEndpoint("http://127.0.0.1:1"),
        withInterceptors(
          createWebSocketInterceptor(() => {
            throw thrown;
          }),
        ),
      );
      const [fault, session] = await useRoom(client);
      expect(session).toBeUndefined();
      expect(fault).toBe(thrown);
    }
  });

  test("should report an interceptor throw as EXT_INTERCEPTOR_FAILED and keep the cause", async () => {
    const cause = new Error("interceptor exploded");
    const client = createClient(
      withEndpoint("http://127.0.0.1:1"),
      withInterceptors(createWebSocketInterceptor(() => Promise.reject(cause))),
    );

    const [fault, session] = await useRoom(client);

    expect(session).toBeUndefined();
    expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(fault?.cause).toBe(cause);
  });

  test("should report an interceptor's foreign Error with a string code as EXT_INTERCEPTOR_FAILED", async () => {
    const cause = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    const client = createClient(
      withEndpoint("http://127.0.0.1:1"),
      withInterceptors(createWebSocketInterceptor(() => Promise.reject(cause))),
    );

    const [fault, session] = await useRoom(client);

    expect(session).toBeUndefined();
    expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(fault?.cause).toBe(cause);
  });

  test("should report a refused connection as a transport fault, not an interceptor fault", async () => {
    // The startup catch is the funnel for every failure, so it must not relabel this one.
    const [fault, session] = await useRoom(unreachableClient());

    expect(session).toBeUndefined();
    expect(fault?.code).not.toBe("EXT_INTERCEPTOR_FAILED");
    expect(fault?.code.startsWith("NET_")).toBe(true);
  });

  test("should report a throwing beforeConnect hook as EXT_HOOK_FAILED", async () => {
    const cause = new Error("token refresh failed");
    const client = unreachableClient(
      withWebSocketBeforeConnect(() => {
        throw cause;
      }),
    );

    const [fault] = await useRoom(client);

    expect(fault?.code).toBe("EXT_HOOK_FAILED");
    expect(fault?.cause).toBe(cause);
  });

  test("should report invalid input as REQ_INPUT_INVALID", async () => {
    const useTyped = defineWebSocket({
      builder: (input) => ({ path: input }),
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      input: struct.object({ room: struct.number() }),
      path: "/ws/:room",
    });

    const [fault] = await useTyped(unreachableClient(), { room: NaN });

    expect(fault?.code).toBe("REQ_INPUT_INVALID");
  });

  test("should close the socket and not retry when binaryType is read-only", async () => {
    const fake = createFakeWebSocket();
    const errorListenersAtClose: number[] = [];
    class ReadOnlyBinaryTypeSocket extends fake.Socket {
      override get binaryType(): "arraybuffer" | "blob" {
        return "blob";
      }

      override close(code?: number, reason?: string): void {
        errorListenersAtClose.push(this.listenerCount("error"));
        super.close(code, reason);
      }
    }

    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(ReadOnlyBinaryTypeSocket),
    );
    const [fault, session] = await useRoom(
      client({ retry: { maxRetries: 2, delayMs: 0 } }),
    );

    expect(session).toBeUndefined();
    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(fault?.cause).toBeInstanceOf(TypeError);
    // The platform refused the socket: a local failure that a retry would only repeat.
    expect(fake.sockets).toHaveLength(1);
    expect(
      fake.sockets.filter((socket) => socket.readyState === FakeWebSocket.OPEN),
    ).toHaveLength(0);
    expect(fake.sockets.every((socket) => socket.closeCalls.length === 1)).toBe(
      true,
    );
    // An EventEmitter-based handle (ws) throws a late `error` that has no listener, so the
    // transport must already have an error listener installed when it closes the socket.
    expect(errorListenersAtClose.every((count) => count >= 1)).toBe(true);
  });
});
