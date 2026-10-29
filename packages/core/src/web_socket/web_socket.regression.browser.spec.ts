import { expect, inject, test } from "vitest";
import { createClient, withEndpoint, withWebSocketHandle } from "../client";
import { struct } from "../struct";
import { defineWebSocket } from "./index";

test("immediate clean close settles according to observed native events", async () => {
  const endpoint = inject("testServerHost");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const events: string[] = [];
    const cancellation = new AbortController();
    let closeNative: () => void = () => undefined;
    let finishNative: () => void = () => undefined;
    const nativeClosed = new Promise<void>((resolve) => {
      finishNative = resolve;
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      watchdog = setTimeout(
        () =>
          reject(
            new Error(
              `Immediate close timed out: ${JSON.stringify({ attempt, events })}`,
            ),
          ),
        5_000,
      );
    });
    class RecordingSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        closeNative = () => {
          try {
            if (this.readyState < WebSocket.CLOSING) this.close();
          } catch (error) {
            events.push(
              `cleanup-error:${error instanceof Error ? error.message : String(error)}`,
            );
          }
        };
        this.addEventListener("open", () => events.push("open"));
        this.addEventListener("error", () => events.push("error"));
        this.addEventListener("close", (event) => {
          events.push(`close:${event.code}:${event.wasClean}`);
          finishNative();
        });
      }
    }
    const work = async () => {
      const client = createClient(
        withEndpoint(endpoint),
        withWebSocketHandle(RecordingSocket),
      );
      const connect = defineWebSocket({
        incoming: struct.unknown(),
        maxIncomingQueueSize: 4,
        path: "/ws/close-immediately",
      });
      const [fault, session] = await client.execute(connect(), {
        signal: cancellation.signal,
      });
      const closed = session ? (await session.closed).kind : undefined;
      await nativeClosed;
      return { fault: fault?.code ?? null, closed };
    };
    const result = await Promise.race([work(), expired]).finally(() => {
      clearTimeout(watchdog);
      cancellation.abort();
      closeNative();
    });
    expect(events.some((event) => event.startsWith("close:"))).toBe(true);
    if (events.includes("open")) {
      expect(result.fault).toBeNull();
      expect(result.closed).toBe("closed");
    } else {
      expect(result.fault).toBe("NET_UNREACHABLE");
    }
  }
}, 30_000);

test("original 10ms closes agree with native-only controls", async () => {
  const endpoint = inject("testServerHost");
  for (const blockMs of [0, 25]) {
    for (const route of ["error-before-close", "binary"]) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        for (const mode of ["native", "library"]) {
          const events: string[] = [];
          const frames: string[] = [];
          const messages: unknown[] = [];
          const runtimeErrors: string[] = [];
          let fault: string | null = null;
          let closed: string | undefined;
          const cancellation = new AbortController();
          let closeNative: () => void = () => undefined;
          let finishNative: () => void = () => undefined;
          const nativeClosed = new Promise<void>((resolve) => {
            finishNative = resolve;
          });
          let watchdog: ReturnType<typeof setTimeout> | undefined;
          const trace = () =>
            JSON.stringify({
              attempt,
              blockMs,
              route,
              mode,
              events,
              frames,
              messages,
              runtimeErrors,
              fault,
              closed,
            });
          const expired = new Promise<never>((_resolve, reject) => {
            watchdog = setTimeout(
              () => reject(new Error(`10ms close timed out: ${trace()}`)),
              3_000,
            );
          });
          class RecordingSocket extends WebSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
              super(url, protocols);
              closeNative = () => {
                try {
                  if (this.readyState < WebSocket.CLOSING) this.close();
                } catch (error) {
                  events.push(
                    `cleanup-error:${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              };
              this.binaryType = "arraybuffer";
              this.addEventListener("open", () => events.push("open"));
              this.addEventListener("error", () => events.push("error"));
              this.addEventListener("message", (event) => {
                events.push("message");
                frames.push(
                  typeof event.data === "string"
                    ? event.data
                    : new TextDecoder().decode(event.data),
                );
              });
              this.addEventListener("close", (event) => {
                events.push(`close:${event.code}:${event.wasClean}`);
                finishNative();
              });
              // Hold only the browser event loop; the real server still closes at 10ms.
              const end = performance.now() + blockMs;
              while (performance.now() < end) {
                /* deliberate scheduling stress */
              }
            }
          }
          const work = async () => {
            const protocols = route === "binary" ? ["json"] : undefined;
            const path = `/ws/regression/${route}`;
            if (mode === "native") {
              new RecordingSocket(
                `${endpoint.replace(/^http/, "ws")}${path}`,
                protocols,
              );
            } else {
              const client = createClient(
                withEndpoint(endpoint),
                withWebSocketHandle(RecordingSocket),
              );
              const connect = defineWebSocket({
                incoming: struct.object({
                  type: struct.literal("message"),
                  text: struct.string(),
                }),
                maxIncomingQueueSize: 4,
                path,
                protocols,
              });
              const [error, session] = await client.execute(connect(), {
                signal: cancellation.signal,
              });
              fault = error?.code ?? null;
              if (session) {
                session.onRuntimeError((error) =>
                  runtimeErrors.push(
                    error instanceof Error ? error.name : String(error),
                  ),
                );
                closed = (await session.closed).kind;
                for await (const message of session.receive)
                  messages.push(message);
              }
            }
            await nativeClosed;
          };
          try {
            await Promise.race([work(), expired]);
          } finally {
            clearTimeout(watchdog);
            cancellation.abort();
            closeNative();
          }
          try {
            // Firefox may close before open; the native trace defines the expected library result.
            const opened = events.includes("open");
            expect(
              events.map((event) =>
                event.startsWith("close:") ? "close" : event,
              ),
            ).toEqual(opened ? ["open", "message", "close"] : ["close"]);
            expect(events.at(-1)).toMatch(/^close:1000:(true|false)$/);
            expect(frames).toEqual(
              opened
                ? [
                    JSON.stringify({
                      type: "message",
                      text: route === "binary" ? "hello-binary" : 123,
                    }),
                  ]
                : [],
            );
            if (mode === "library") {
              expect(fault).toBe(opened ? null : "NET_UNREACHABLE");
              expect(closed).toBe(opened ? "closed" : undefined);
              expect(messages).toEqual(
                opened && route === "binary"
                  ? [{ type: "message", text: "hello-binary" }]
                  : [],
              );
              expect(runtimeErrors).toEqual(
                opened && route === "error-before-close" ? ["StructError"] : [],
              );
            }
          } catch (error) {
            console.error("WebSocket close observation:", trace());
            throw error;
          }
        }
      }
    }
  }
}, 60_000);

test("rejects an optional outgoing root that has no JSON representation", async () => {
  const client = createClient(withEndpoint(inject("testServerHost")));
  const connect = defineWebSocket({
    incoming: struct.object({ received: struct.string() }),
    outgoing: struct.string().optional(),
    maxIncomingQueueSize: 4,
    path: "/ws/regression/capture",
  });
  const [error, session] = await client.execute(connect(), { timeout: 2_000 });
  expect(error).toBeNull();
  if (!session) throw new Error("Expected an open session");
  const watchdog = setTimeout(() => session.close(), 2_000);
  try {
    expect(() => session.send(undefined)).toThrow();
    session.send("after-rejected-send");
    await expect(
      session.receive[Symbol.asyncIterator]().next(),
    ).resolves.toEqual({
      done: false,
      value: { received: '"after-rejected-send"' },
    });
  } finally {
    clearTimeout(watchdog);
    session.close();
    await session.closed;
  }
}, 15_000);
