import { describe, expect, test } from "vitest";
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketHandle,
} from "../index";
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
      await expect(iterator.next()).rejects.toBe(closed.cause);
      expect(session.state).toBe("error");
    },
  );
});
