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

const BURST = 100;

describe("WebSocket incoming bursts", () => {
  test.each([
    ["reads each message directly", 0],
    ["awaits three microtasks per message", 3],
    ["waits a task turn per message", -1],
  ])(
    "delivers every message of one synchronous burst when the consumer %s",
    async (_name, microtasks) => {
      const { Socket, latest } = createControllableSocketClass();
      const open = defineWebSocket({
        incoming: struct.number(),
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
          if (microtasks < 0) {
            await yieldMacrotask();
          }
          for (let step = 0; step < microtasks; step += 1)
            await Promise.resolve();
          received.push(value);
        }
      })();
      // The native handle delivers a whole read in one task, so the pump cannot run between messages.
      for (let value = 1; value <= BURST; value += 1) {
        socket.triggerMessage(String(value));
      }
      socket.triggerClose({ code: 1000, reason: "done", wasClean: true });

      await consumed;
      expect(received).toEqual(Array.from({ length: BURST }, (_, i) => i + 1));
      expect(await session.closed).toMatchObject({ kind: "closed" });
    },
  );

  test("delivers every frame queued behind a Blob that is still being read", async () => {
    const { Socket, latest } = createControllableSocketClass();
    const open = defineWebSocket({
      incoming: struct.unknown(),
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
    const blob = new GatedBlob();
    socket.triggerMessage(blob);
    for (let value = 1; value <= BURST; value += 1) {
      socket.triggerMessage(String(value));
    }
    // The pump is parked on the Blob while the raw frames pile up behind it.
    await yieldMacrotask();
    expect(session.state).toBe("open");

    blob.gate.resolve(new TextEncoder().encode("0").buffer);
    socket.triggerClose({ code: 1000, reason: "done", wasClean: true });

    const received: unknown[] = [];
    for await (const value of session.receive) {
      received.push(value);
    }
    expect(received).toEqual(Array.from({ length: BURST + 1 }, (_, i) => i));
    expect(await session.closed).toMatchObject({ kind: "closed" });
  });
});
