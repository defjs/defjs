import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withSSEHandle,
  withSSEReconnect,
  withWebSocketHandle,
  withWebSocketReconnect,
} from "../client/option";
import { defineEventStream } from "../sse/sse";
import { defineWebSocket } from "../web_socket/web_socket";
import { struct } from "../struct";
import { createControllableSocketClass } from "../../test/regression/controllable_socket";

afterEach(() => vi.useRealTimers());

test.each([2_147_483_647, 2_147_483_648])(
  "SSE connectTimeoutMs validates platform boundary %s at execution",
  async (connectTimeoutMs) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const handle = vi.fn(() =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );
    const client = createClient(
      withEndpoint("https://a.test"),
      withSSEHandle(handle),
      withSSEReconnect({ connectTimeoutMs }),
    );
    const [fault, stream] = await defineEventStream({
      path: "/",
      events: { message: struct.string() },
    })(client);
    expect(fault?.code ?? null).toBe(
      connectTimeoutMs === 2_147_483_647 ? null : "REQ_OPTIONS_INVALID",
    );
    expect(handle).toHaveBeenCalledTimes(
      connectTimeoutMs === 2_147_483_647 ? 1 : 0,
    );
    stream?.close();
    await stream?.closed;
    expect(vi.getTimerCount()).toBe(0);
  },
);

test.each([2_147_483_647, 2_147_483_648])(
  "WebSocket connectTimeoutMs validates platform boundary %s at execution",
  async (connectTimeoutMs) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { Socket, latest } = createControllableSocketClass();
    class OpeningSocket extends Socket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        queueMicrotask(() => this.triggerOpen());
      }
    }
    const client = createClient(
      withEndpoint("https://a.test"),
      withWebSocketHandle(OpeningSocket),
      withWebSocketReconnect({ connectTimeoutMs }),
    );
    const pending = defineWebSocket({
      path: "/",
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
    })(client);
    const [fault, session] = await pending;
    expect(fault?.code ?? null).toBe(
      connectTimeoutMs === 2_147_483_647 ? null : "REQ_OPTIONS_INVALID",
    );
    expect(latest() !== undefined).toBe(connectTimeoutMs === 2_147_483_647);
    session?.close();
    latest()?.triggerClose({ code: 1000, reason: "", wasClean: true });
    await session?.closed;
    expect(vi.getTimerCount()).toBe(0);
  },
);
