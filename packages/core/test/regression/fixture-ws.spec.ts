import { expect, inject, test } from "vitest";
import { fixture } from "../fixture/client-auto.ts";

function open(url: string): {
  socket: WebSocket;
  messages: string[];
  closed: Promise<CloseEvent>;
  opened: Promise<void>;
} {
  const socket = new WebSocket(url);
  const messages: string[] = [];
  let openedOnce = false;
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener(
      "open",
      () => {
        openedOnce = true;
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket failed to open")),
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => {
        if (!openedOnce) reject(new Error("WebSocket closed before open"));
      },
      { once: true },
    );
  });
  const closed = new Promise<CloseEvent>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event), {
      once: true,
    });
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") messages.push(event.data);
  });
  return { socket, messages, closed, opened };
}

test("ws scenario sends the messages in order, then closes with closeWith", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const base = await f.endpoint("sock", "ws", {
    send: ["a", "b"],
    closeWith: { code: 4001, reason: "bye" },
  });
  const connection = open(base.replace(/^http/, "ws") + "/ws");
  await connection.opened;
  const closed = await connection.closed;
  expect(connection.messages).toEqual(["a", "b"]);
  expect(closed.code).toBe(4001);
  expect(closed.reason).toBe("bye");
});

test("act end closes normally, terminate abnormally, drop is 409", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const base = await f.endpoint("sock", "ws", { send: [] });
  const url = base.replace(/^http/, "ws") + "/ws";

  const ended = open(url);
  await ended.opened;
  await f.act("sock", "end");
  expect((await ended.closed).code).toBe(1000);

  const terminated = open(url);
  await terminated.opened;
  await f.act("sock", "terminate");
  expect((await terminated.closed).code).toBe(1006);

  const dropped = open(url);
  await dropped.opened;
  await expect(f.act("sock", "drop")).rejects.toThrow(/-> 409$/);
});

test("the upgrade request is logged; a plain GET is 426", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const base = await f.endpoint("sock", "ws", { send: [] });
  const connection = open(base.replace(/^http/, "ws") + "/ws");
  await connection.opened;
  const logged = await f.log({ wait: 1 });
  const request = logged.requests[0];
  if (request === undefined) throw new Error("missing upgrade log");
  expect(request.endpoint).toBe("sock");
  expect(request.path).toBe("/ws");
  expect((await fetch(`${base}/ws`)).status).toBe(426);
});
