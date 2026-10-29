import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
  withWebSocketHandle,
} from "../../src";
import type { AnyStruct, Client, HttpExecuteOptions } from "../../src";

type Transport = "HTTP" | "SSE" | "WebSocket";

function executeInput(
  client: Client,
  transport: Transport,
  schema: AnyStruct | undefined,
  input: unknown,
  builder: (input: unknown) => Record<string, never>,
  options?: HttpExecuteOptions,
) {
  const definition = { builder, input: schema, path: "/input" };
  if (transport === "HTTP") {
    return client.execute(
      defineRequest({ ...definition, method: "GET" })(input),
      options,
    );
  }
  if (transport === "SSE") {
    return client.execute(
      defineEventStream({
        ...definition,
        events: { message: struct.unknown() },
        maxBufferSize: 1024,
        maxQueueSize: 1,
      })(input),
      options,
    );
  }
  return client.execute(
    defineWebSocket({
      ...definition,
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
    })(input),
    options,
  );
}

function transportHarness(transport: Transport, pending = false) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (pending) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = new Request(_input, init).signal;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }
    return transport === "SSE"
      ? new Response(": done\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      : new Response(null, { status: 204 });
  });
  const sockets: Socket[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readonly url: string;
    readyState = 0;
    bufferedAmount = 0;
    extensions = "";
    protocol = "";
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      sockets.push(this);
      if (!pending)
        queueMicrotask(() => {
          if (this.readyState !== 0) return;
          this.readyState = Socket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
    }
    send(): void {}
    close = vi.fn(() => {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    });
  }
  return {
    client: createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(fetch),
      withSSEHandle(fetch),
      withWebSocketHandle(Socket),
    ),
    fetch,
    sockets,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(["HTTP", "SSE", "WebSocket"] as const)(
  "%s root input",
  (transport) => {
    describe.each([
      { name: "unknown", schema: struct.unknown() },
      { name: "any", schema: struct.any() },
      { name: "omitted struct", schema: undefined },
    ])("$name", ({ schema }) => {
      test.each(["resolving thenable", "throwing getter", "Promise"] as const)(
        "passes %s data unchanged to the builder",
        async (mode) => {
          const then = vi.fn((resolve: (value: unknown) => void) =>
            resolve("replacement"),
          );
          const getter = vi.fn(() => {
            if (mode === "throwing getter")
              throw new Error("data getter must not run");
            return then;
          });
          const input =
            mode === "Promise"
              ? Promise.resolve("replacement")
              : Object.defineProperty({ marker: "original" }, "then", {
                  get: getter,
                });
          const seen: unknown[] = [];
          const { client } = transportHarness(transport);

          const [fault, resource] = await executeInput(
            client,
            transport,
            schema,
            input,
            (value) => {
              seen.push(value);
              return {};
            },
          );
          resource?.close();
          await resource?.closed;

          expect(fault).toBeNull();
          expect(seen).toHaveLength(1);
          expect(seen[0]).toBe(input);
          expect(getter).not.toHaveBeenCalled();
          expect(then).not.toHaveBeenCalled();
        },
      );

      test.each(["abort", "signal", "timeout"] as const)(
        "settles %s and releases resources without waiting for input then",
        async (mode) => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
          const caller = new AbortController();
          const add = vi.spyOn(caller.signal, "addEventListener");
          const remove = vi.spyOn(caller.signal, "removeEventListener");
          let releaseInput: (value: unknown) => void = () => undefined;
          const then = vi.fn((resolve: (value: unknown) => void) => {
            releaseInput = resolve;
          });
          const input = { then };
          const seen: unknown[] = [];
          const { client, fetch, sockets } = transportHarness(transport, true);
          const options =
            mode === "timeout"
              ? { signal: caller.signal, timeout: 10 }
              : { [mode]: caller.signal };
          let settled: Awaited<ReturnType<typeof executeInput>> | undefined;
          const pending = executeInput(
            client,
            transport,
            schema,
            input,
            (value) => {
              seen.push(value);
              return {};
            },
            options,
          ).then((result) => {
            settled = result;
            return result;
          });
          if (mode !== "timeout")
            setTimeout(() => caller.abort("caller stopped"), 1);

          try {
            await vi.advanceTimersByTimeAsync(10);

            expect(settled).toBeDefined();
            expect(settled?.[0]?.code).toBe(
              mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
            );
            expect(settled?.[1]).toBeUndefined();
            expect(seen).toHaveLength(1);
            expect(seen[0]).toBe(input);
            expect(then).not.toHaveBeenCalled();
            if (transport === "WebSocket") {
              expect(sockets).toHaveLength(1);
              expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
            } else {
              expect(fetch).toHaveBeenCalledTimes(1);
            }
            const added = add.mock.calls.filter(([type]) => type === "abort");
            expect(added.length).toBeGreaterThan(0);
            expect(
              remove.mock.calls.filter(([type]) => type === "abort"),
            ).toHaveLength(added.length);
            for (const [type, listener] of added)
              expect(remove).toHaveBeenCalledWith(type, listener);
            expect(vi.getTimerCount()).toBe(0);
          } finally {
            // Release only the broken implementation's accidental assimilation so failed RED tests leave no work behind.
            releaseInput("replacement");
            await pending;
          }
        },
      );
    });

    test("passes parsed object roots without executing their then field", async () => {
      const then = vi.fn((resolve: (value: unknown) => void) =>
        resolve("replacement"),
      );
      const schema = struct.object({
        id: struct.string(),
        then: struct.unknown(),
      });
      const input = { id: "Ada", then };
      const seen: unknown[] = [];
      const { client } = transportHarness(transport);

      const [fault, resource] = await executeInput(
        client,
        transport,
        schema,
        input,
        (value) => {
          seen.push(value);
          return {};
        },
      );
      resource?.close();
      await resource?.closed;

      expect(fault).toBeNull();
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toBe(input);
      expect(seen[0]).toMatchObject({ id: "Ada", then });
      expect(then).not.toHaveBeenCalled();
    });
  },
);
