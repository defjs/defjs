import { describe, expect, test } from "vitest";
import type { HttpRequest } from "../http";
import type {
  WebSocketInterceptorFn,
  WebSocketSessionLike,
} from "./interceptor";
import { createWebSocketInterceptor, makeChain } from "./interceptor";

function probeSession(url = "ws://test"): WebSocketSessionLike {
  return {
    bufferedAmount: 0,
    connection: { generation: 0, url },
    closed: Promise.resolve({ kind: "closed" }),
    receive: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<unknown>> {
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
    state: "open",
    close() {
      return undefined;
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve();
    },
    onRuntimeError() {
      return () => undefined;
    },
    onStateChange() {
      return () => undefined;
    },
    send() {
      return undefined;
    },
  };
}

describe("WebSocket interceptor chain", () => {
  test("should apply WebSocket interceptors and pass modified request to handler", async () => {
    const callOrder: string[] = [];
    const baseRequest: HttpRequest = {
      endpoint: "/ws",
      headers: new Headers(),
      method: "GET",
    };

    const interceptors: WebSocketInterceptorFn[] = [
      async (request, next) => {
        callOrder.push("first");
        const headers = new Headers(request.headers);
        headers.set("x-first", "1");
        return next({ ...request, headers });
      },
      async (request, next) => {
        callOrder.push("second");
        const headers = new Headers(request.headers);
        headers.set("x-second", "2");
        return next({ ...request, headers });
      },
    ];

    let capturedRequest: HttpRequest | undefined;
    const fakeWsHandler = (req: HttpRequest) => {
      capturedRequest = req;
      return Promise.resolve(probeSession());
    };

    const chain = makeChain(interceptors);
    await chain(baseRequest, fakeWsHandler);

    expect(callOrder).toEqual(["first", "second"]);
    expect(capturedRequest?.headers?.get("x-first")).toBe("1");
    expect(capturedRequest?.headers?.get("x-second")).toBe("2");
  });

  test("WebSocket interceptor can wrap the returned session", async () => {
    const fakeSession = probeSession();
    const interceptor: WebSocketInterceptorFn = async (req, next) => {
      const session = await next(req);
      return Object.assign(session, { wrapped: true });
    };

    const chain = makeChain([interceptor]);
    const result = await chain({ endpoint: "/ws", method: "GET" }, () =>
      Promise.resolve(fakeSession),
    );

    expect("wrapped" in result && result.wrapped).toBe(true);
  });

  test("createWebSocketInterceptor should return kind web-socket", () => {
    const interceptor = createWebSocketInterceptor((req, next) => next(req));
    expect(interceptor.kind).toBe("web-socket");
    expect(typeof interceptor.fn).toBe("function");
  });
});
