import { expect, inject, onTestFinished, test } from "vitest";
import { createFixtureClient } from "../../core/test/fixture/client.ts";

test("act terminate closes a WebSocket endpoint with 1006 and log lists the upgrade", async () => {
  const client = createFixtureClient(
    inject("testServerHost"),
    inject("fixtureToken"),
  );
  onTestFinished(() => client.delete());
  const base = await client.endpoint("sock", "ws", { send: ["hello"] });
  const socket = new WebSocket(base.replace(/^http:/, "ws:"));
  const message = await new Promise<string>((resolve, reject) => {
    socket.addEventListener("message", (event) => resolve(String(event.data)));
    socket.addEventListener("error", () =>
      reject(new Error("WebSocket error")),
    );
  });
  expect(message).toBe("hello");
  const closed = new Promise<CloseEvent>((resolve) =>
    socket.addEventListener("close", resolve),
  );
  await client.act("sock", "terminate");
  expect((await closed).code).toBe(1006);
  expect((await client.log()).requests.map((r) => r.endpoint)).toEqual([
    "sock",
  ]);
});

test("delete removes the fixture state so later control calls fail with 404", async () => {
  const client = createFixtureClient(
    inject("testServerHost"),
    inject("fixtureToken"),
  );
  onTestFinished(() => client.delete());
  await client.endpoint("sock", "ws", { send: [] });
  await client.delete();
  await expect(client.log()).rejects.toThrow("-> 404");
});
