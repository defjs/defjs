import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { expect, test } from "vitest";
import { startHonoTestServer } from "../../../../test/hono-test-server";

test("the test server exchanges WebSocket messages and closes active connections on shutdown", async () => {
  const app = new Hono();
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onMessage(event, socket) {
        socket.send(typeof event.data === "string" ? event.data : "");
      },
    })),
  );

  const server = await startHonoTestServer(app);
  const socket = new WebSocket(`${server.host.replace("http:", "ws:")}/ws`);
  const opened = new Promise<string>((resolve) => {
    socket.addEventListener("open", () => resolve("open"), { once: true });
    socket.addEventListener("error", () => resolve("error"), { once: true });
  });
  const closed = new Promise<void>((resolve) =>
    socket.addEventListener("close", () => resolve(), { once: true }),
  );

  try {
    expect(await opened).toBe("open");
    const message = new Promise<MessageEvent>((resolve) =>
      socket.addEventListener("message", resolve, { once: true }),
    );
    socket.send("probe");
    expect((await message).data).toBe("probe");

    await server.close();
    await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    await expect(fetch(server.host)).rejects.toThrow();

    await server.close();
  } finally {
    socket.close();
    await server.close();
  }
});
