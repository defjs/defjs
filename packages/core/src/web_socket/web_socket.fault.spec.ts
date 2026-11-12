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
      let constructed = 0;
      class Socket extends EventTarget {
        static readonly OPEN = 1;
        readyState = 0;
        bufferedAmount = 0;
        protocol = "";
        extensions = "";
        binaryType = "blob";
        readonly url: string;
        constructor(url: string | URL) {
          super();
          this.url = String(url);
          constructed += 1;
        }
        send(_data: string) {}
        close() {
          this.readyState = 3;
        }
      }
      const client = createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(Socket),
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

      expect(constructed).toBe(0);
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
    const sockets: Array<{
      closeCalls: number;
      errorListenersAtClose: number;
      readyState: number;
    }> = [];
    class ReadOnlyBinaryTypeSocket {
      static readonly OPEN = 1;
      bufferedAmount = 0;
      closeCalls = 0;
      errorListeners = 0;
      errorListenersAtClose = 0;
      extensions = "";
      protocol = "";
      readyState = 1;
      readonly url: string;

      constructor(url: string | URL) {
        this.url = String(url);
        sockets.push(this);
      }

      get binaryType(): string {
        return "blob";
      }

      close(): void {
        this.closeCalls += 1;
        this.errorListenersAtClose = this.errorListeners;
        this.readyState = 3;
      }

      send(_data: string): void {}

      addEventListener(type: string): void {
        if (type === "error") this.errorListeners += 1;
      }

      removeEventListener(): void {}
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
    expect(sockets).toHaveLength(1);
    expect(
      sockets.filter(
        (socket) => socket.readyState === ReadOnlyBinaryTypeSocket.OPEN,
      ),
    ).toHaveLength(0);
    expect(sockets.every((socket) => socket.closeCalls === 1)).toBe(true);
    // An EventEmitter-based handle (ws) throws a late `error` that has no listener, so the
    // transport must already have an error listener installed when it closes the socket.
    expect(sockets.every((socket) => socket.errorListenersAtClose >= 1)).toBe(
      true,
    );
  });
});
