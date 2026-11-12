import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint, withWebSocketHandle } from "../client";
import { struct } from "../struct";
import { createFakeWebSocket, openSession } from "../../test/fake_web_socket";
import { defineWebSocket } from "./index";
import { useFakeClock } from "../../test/web_socket_support";

describe("web socket runtime heartbeat", () => {
  test("should send heartbeat messages automatically when heartbeat.message is provided", async () => {
    useFakeClock();
    const fake = createFakeWebSocket({ handshake: "manual" });
    const useHeartbeatSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      outgoing: struct.object({
        type: struct.literal("ping"),
        at: struct.number(),
      }),
      path: "/ws/heartbeat",
    });
    let runtimeError: unknown;
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(fake.Socket),
    );
    const { session: socket, socket: native } = await openSession(
      useHeartbeatSocket(
        client({
          heartbeat: {
            intervalMs: 10,
            isAck(message: unknown) {
              return (
                typeof message === "object" &&
                message !== null &&
                "type" in message &&
                message.type === "pong"
              );
            },
            message: () => ({
              at: 1,
              type: "ping" as const,
            }),
            timeoutMs: 100,
          },
        }),
      ),
      fake,
    );

    socket.onRuntimeError((err: unknown) => {
      runtimeError = err;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(native.sentText(0))).toEqual({ at: 1, type: "ping" });
    native.receive('{"ok":true,"type":"pong"}');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(runtimeError).toBeUndefined();
    expect(socket.state).toBe("open");
    socket.close(1000, "heartbeat-ok");
    native.peerClose(1000, "heartbeat-ok");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      reason: "heartbeat-ok",
    });
  });
});
