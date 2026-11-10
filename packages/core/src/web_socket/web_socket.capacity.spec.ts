import { describe, expect, test } from "vitest";
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketHandle,
} from "../index";
import { yieldMacrotask } from "../../test/macrotask";
import {
  createControllableSocketClass,
  openControllableSocket,
} from "../../test/regression/controllable_socket";

describe("WebSocket incoming capacity faults", () => {
  test.each(["decoded", "raw"] as const)(
    "reports %s queue overflow as CAP_QUEUE_OVERFLOW through every runtime delivery point",
    async (queue) => {
      const { Socket, latest } = createControllableSocketClass();
      const open = defineWebSocket({
        incoming: struct.unknown(),
        maxIncomingQueueSize: 1,
        path: "/socket",
      });
      const pending = open(
        createClient(
          withEndpoint("https://example.test"),
          withWebSocketHandle(Socket),
        ),
      );
      const [error, session] = await openControllableSocket(pending, latest);
      expect(error).toBeNull();
      const socket = latest();
      if (!session || !socket) throw new Error("Expected open socket");
      const observed: unknown[] = [];
      session.onRuntimeError((fault) => observed.push(fault));
      const iterator = session.receive[Symbol.asyncIterator]();
      if (queue === "raw") {
        class PendingBlob extends Blob {
          override arrayBuffer(): Promise<ArrayBuffer> {
            return new Promise(() => undefined);
          }
        }
        socket.triggerMessage(new PendingBlob());
      }
      socket.triggerMessage("1");
      socket.triggerMessage("2");

      const closed = await session.closed;
      expect(closed).toMatchObject({
        kind: "error",
        cause: { code: "CAP_QUEUE_OVERFLOW" },
      });
      if (closed.kind !== "error") throw new Error("Expected capacity failure");
      expect(closed.cause).toBeInstanceOf(Error);
      expect(observed).toEqual([closed.cause]);
      if (queue === "decoded") {
        // Both decoded messages were queued before the deferred check ran, and both still reach the consumer.
        await expect(iterator.next()).resolves.toEqual({
          done: false,
          value: 1,
        });
        await expect(iterator.next()).resolves.toEqual({
          done: false,
          value: 2,
        });
      }
      await expect(iterator.next()).rejects.toBe(closed.cause);
      expect(session.state).toBe("error");
    },
  );

  test.each([
    ["reads each message directly", 0],
    ["awaits three microtasks per message", 3],
  ])(
    "keeps the session open when one synchronous burst exceeds maxIncomingQueueSize and the consumer %s",
    async (_name, microtasks) => {
      const { Socket, latest } = createControllableSocketClass();
      const open = defineWebSocket({
        incoming: struct.number(),
        maxIncomingQueueSize: 4,
        path: "/socket",
      });
      const pending = open(
        createClient(
          withEndpoint("https://example.test"),
          withWebSocketHandle(Socket),
        ),
      );
      const [error, session] = await openControllableSocket(pending, latest);
      expect(error).toBeNull();
      const socket = latest();
      if (!session || !socket) throw new Error("Expected open socket");
      const received: number[] = [];
      const consumed = (async () => {
        for await (const value of session.receive) {
          for (let step = 0; step < microtasks; step += 1)
            await Promise.resolve();
          received.push(value);
        }
      })();
      // The native handle delivers a whole read in one task, so the pump cannot run between messages.
      for (let value = 1; value <= 50; value += 1) {
        socket.triggerMessage(String(value));
      }
      socket.triggerClose({ code: 1000, reason: "done", wasClean: true });

      await consumed;
      expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(await session.closed).toMatchObject({ kind: "closed" });
    },
  );

  test("keeps the session open after the backlog check finds the burst already drained", async () => {
    const { Socket, latest } = createControllableSocketClass();
    const open = defineWebSocket({
      incoming: struct.number(),
      maxIncomingQueueSize: 4,
      path: "/socket",
    });
    const pending = open(
      createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(Socket),
      ),
    );
    const [error, session] = await openControllableSocket(pending, latest);
    expect(error).toBeNull();
    const socket = latest();
    if (!session || !socket) throw new Error("Expected open socket");
    const received: number[] = [];
    const consumed = (async () => {
      for await (const value of session.receive) {
        received.push(value);
        if (received.length === 50) break;
      }
    })();
    for (let value = 1; value <= 50; value += 1) {
      socket.triggerMessage(String(value));
    }

    await consumed;
    // The check armed by the burst fires on a timer that was queued before this one.
    await yieldMacrotask();
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(session.state).toBe("open");
    socket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    expect(await session.closed).toMatchObject({ kind: "closed" });
  });

  test("does not overflow when the raw backlog has shrunk to maxIncomingQueueSize by the time the check runs", async () => {
    const { Socket, latest } = createControllableSocketClass();
    const open = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 4,
      path: "/socket",
    });
    const pending = open(
      createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(Socket),
      ),
    );
    const [error, session] = await openControllableSocket(pending, latest);
    expect(error).toBeNull();
    const socket = latest();
    if (!session || !socket) throw new Error("Expected open socket");
    class GatedBlob extends Blob {
      readonly gate = Promise.withResolvers<ArrayBuffer>();
      override arrayBuffer(): Promise<ArrayBuffer> {
        return this.gate.promise;
      }
    }
    const first = new GatedBlob();
    const second = new GatedBlob();
    const frame = new TextEncoder().encode("1").buffer;
    socket.triggerMessage(first);
    socket.triggerMessage("1");
    socket.triggerMessage(second);
    for (let value = 2; value <= 5; value += 1) {
      socket.triggerMessage(String(value));
    }
    // Five frames are raw-queued, one more than the bound, so the backlog check is armed.
    first.gate.resolve(frame);
    // The pump now parks on the second blob with exactly maxIncomingQueueSize raw frames left behind it.
    await yieldMacrotask();

    expect(session.state).toBe("open");
    second.gate.resolve(frame);
    socket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    expect(await session.closed).toMatchObject({ kind: "closed" });
  });

  test("does not overflow when the decoded backlog has shrunk to maxIncomingQueueSize by the time the check runs", async () => {
    const { Socket, latest } = createControllableSocketClass();
    const open = defineWebSocket({
      incoming: struct.number(),
      maxIncomingQueueSize: 4,
      path: "/socket",
    });
    const pending = open(
      createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(Socket),
      ),
    );
    const [error, session] = await openControllableSocket(pending, latest);
    expect(error).toBeNull();
    const socket = latest();
    if (!session || !socket) throw new Error("Expected open socket");
    const iterator = session.receive[Symbol.asyncIterator]();
    for (let value = 1; value <= 6; value += 1) {
      socket.triggerMessage(String(value));
    }
    // Let the pump decode every frame without reaching a timer: six decoded values are queued, two over the bound.
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 });
    // Four values remain, exactly the bound, when the armed check runs.
    await yieldMacrotask();

    expect(session.state).toBe("open");
    socket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    const rest: number[] = [];
    for await (const value of { [Symbol.asyncIterator]: () => iterator }) {
      rest.push(value);
    }
    expect(rest).toEqual([3, 4, 5, 6]);
    expect(await session.closed).toMatchObject({ kind: "closed" });
  });

  test("still overflows when a burst is larger than maxIncomingQueueSize and the consumer is slower than a task turn", async () => {
    const { Socket, latest } = createControllableSocketClass();
    const open = defineWebSocket({
      incoming: struct.number(),
      maxIncomingQueueSize: 4,
      path: "/socket",
    });
    const pending = open(
      createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(Socket),
      ),
    );
    const [error, session] = await openControllableSocket(pending, latest);
    expect(error).toBeNull();
    const socket = latest();
    if (!session || !socket) throw new Error("Expected open socket");
    const consumed = (async () => {
      for await (const _value of session.receive) {
        await yieldMacrotask();
      }
    })();
    for (let value = 1; value <= 10; value += 1) {
      socket.triggerMessage(String(value));
    }

    await expect(consumed).rejects.toMatchObject({
      code: "CAP_QUEUE_OVERFLOW",
    });
    expect(await session.closed).toMatchObject({
      kind: "error",
      cause: { code: "CAP_QUEUE_OVERFLOW" },
    });
  });
});
