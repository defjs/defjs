import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint } from "../client";
import { StructError, struct } from "../struct";
import { yieldMacrotask } from "../../test/macrotask";
import { defineWebSocket } from "./index";
import {
  type FakeWebSocket,
  closeEventOnly,
  expectInertErrorListener,
  expectOnlyErrorSink,
  openSession,
  stubFakeWebSocket,
} from "../../test/fake_web_socket";
import {
  useFakeClock,
  createDeferred,
  run,
  encodeMessage,
  watchAbortListeners,
} from "../../test/web_socket_support";

describe("web socket incoming messages with a mock handle", () => {
  test("should report invalid incoming frames without tearing down the session", async () => {
    const fake = stubFakeWebSocket();

    const useSocket = defineWebSocket({
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket] = await run(client, useSocket);
    expect(error).toBeNull();
    if (!socket || !fake.last()) {
      throw new Error("Expected open session");
    }

    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });

    fake.last().receive('{"ok":true}');
    fake.last().receive('{"type":"unknown","ok":true}');
    await vi.waitFor(() => expect(runtimeErrors).toHaveLength(2));
    expect(runtimeErrors[0]).toBeInstanceOf(StructError);
    expect(runtimeErrors[1]).toBeInstanceOf(StructError);

    fake.last().receive('{"type":"known","ok":true}');
    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: "known" },
    });

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should ignore non-text frames without notifying runtime errors", async () => {
    const fake = stubFakeWebSocket();

    const useSocket = defineWebSocket({
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket] = await run(client, useSocket);
    expect(error).toBeNull();
    if (!socket || !fake.last()) {
      throw new Error("Expected open session");
    }

    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });

    // A platform socket delivers a string, an ArrayBuffer or a Blob. Anything else comes from a handle that is not one.
    fake.last().dispatchEvent(new MessageEvent("message", { data: 123 }));
    fake
      .last()
      .dispatchEvent(
        new MessageEvent("message", { data: { ok: true, type: "known" } }),
      );
    fake.last().receive('{"type":"known","ok":true}');

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: "known" },
    });
    expect(runtimeErrors).toEqual([]);

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should preserve physical message arrival order when Blob decodes finish out of order", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    const firstData = createDeferred<ArrayBuffer>();
    const secondData = createDeferred<ArrayBuffer>();
    const firstBlob = new Blob();
    const secondBlob = new Blob();
    vi.spyOn(firstBlob, "arrayBuffer").mockReturnValue(firstData.promise);
    vi.spyOn(secondBlob, "arrayBuffer").mockReturnValue(secondData.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    fake.last().receive(firstBlob);
    fake.last().receive(secondBlob);
    secondData.resolve(encodeMessage({ text: "second", type: "message" }));
    await Promise.resolve();
    firstData.resolve(encodeMessage({ text: "first", type: "message" }));

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "first", type: "message" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "second", type: "message" },
    });
    socket.close(1000, "done");
    await socket.closed;
  });

  test("should deliver an arrived Blob frame before the following native close", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    const data = createDeferred<ArrayBuffer>();
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(data.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    fake.last().receive(blob);
    fake.last().peerClose(1000, "done");
    // The standard fires `close` once. A handle that fires it again must not end the session twice.
    fake.last().dispatchEvent(
      new CloseEvent("close", {
        code: 1000,
        reason: "duplicate",
        wasClean: true,
      }),
    );
    data.resolve(encodeMessage({ text: "before close", type: "message" }));

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "before close", type: "message" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should not wait for a blocked Blob after a native error close", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    const blockedBlob = new Blob();
    vi.spyOn(blockedBlob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );
    fake.last().receive(blockedBlob);
    fake.last().drop();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
  });

  test.each([
    ["error then close", true],
    ["close only", false],
  ] as const)(
    "should deliver queued messages then reject receive after an abrupt drop (%s)",
    async (_name, withErrorEvent) => {
      const fake = stubFakeWebSocket();
      const useSocket = defineWebSocket({
        incoming: struct.object({ n: struct.number() }),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket),
        fake,
      );
      for (const n of [1, 2, 3]) {
        fake.last().receive(JSON.stringify({ n }));
      }
      // The consumer is slow: the frames are decoded and queued before the peer vanishes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (withErrorEvent) {
        fake.last().drop();
      } else {
        closeEventOnly(fake.last(), {
          code: 1006,
          reason: "",
          wasClean: false,
        });
      }

      await expect(socket.closed).resolves.toMatchObject({
        cause: new Error("WebSocket connection error"),
        code: 1006,
        kind: "error",
        wasClean: false,
      });
      const iterator = socket.receive[Symbol.asyncIterator]();
      for (const n of [1, 2, 3]) {
        await expect(iterator.next()).resolves.toEqual({
          done: false,
          value: { n },
        });
      }
      await expect(iterator.next()).rejects.toThrow(
        "WebSocket connection error",
      );
    },
  );

  test("should deliver queued messages before rejecting after a runtime error", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.number(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();
    if (!socket || !nativeSocket) {
      throw new Error("Expected socket");
    }
    for (const value of [1, 2, 3]) {
      nativeSocket.receive(JSON.stringify(value));
    }
    await yieldMacrotask();

    nativeSocket.drop();

    const closed = await socket.closed;
    if (closed.kind !== "error") {
      throw new Error("expected an error close");
    }
    const received: unknown[] = [];
    const rejection = await (async () => {
      try {
        for await (const value of socket.receive) {
          received.push(value);
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(received).toEqual([1, 2, 3]);
    expect(rejection).toBe(closed.cause);
  });

  test("should discard queued messages when the caller aborts the session", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.number(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        signal: controller.signal,
      }),
      fake,
    );
    const nativeSocket = fake.last();
    if (!socket || !nativeSocket) {
      throw new Error("Expected socket");
    }
    for (const value of [1, 2, 3]) {
      nativeSocket.receive(JSON.stringify(value));
    }
    await yieldMacrotask();

    controller.abort();

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    const received: unknown[] = [];
    const rejection = await (async () => {
      try {
        for await (const value of socket.receive) {
          received.push(value);
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(received).toEqual([]);
    expect(rejection).toMatchObject({ name: "AbortError" });
  });

  describe("incoming messages around a close", () => {
    async function openNumberSession(signal?: AbortSignal) {
      const fake = stubFakeWebSocket();
      const useSocket = defineWebSocket({
        incoming: struct.number(),
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(
          createClient(withEndpoint("http://localhost")),
          useSocket,
          signal ? { signal } : undefined,
        ),
        fake,
      );
      const nativeSocket = fake.last();
      if (!socket || !nativeSocket) {
        throw new Error("Expected socket");
      }
      return { nativeSocket, socket };
    }

    async function drainReceive(socket: { receive: AsyncIterable<unknown> }) {
      const received: unknown[] = [];
      for await (const value of socket.receive) {
        received.push(value);
      }
      return received;
    }

    /** Three unread messages, then the peer closes the session or the connection drops. */
    async function openEndedSession(ending: "closed" | "error") {
      const controller = new AbortController();
      const { nativeSocket, socket } = await openNumberSession(
        controller.signal,
      );
      for (const value of [1, 2, 3]) {
        nativeSocket.receive(JSON.stringify(value));
      }
      await yieldMacrotask();
      if (ending === "closed") {
        nativeSocket.peerClose(1000);
      } else {
        nativeSocket.drop();
      }
      const closed = await socket.closed;
      expect(closed.kind).toBe(ending);
      return { closed, controller, socket };
    }

    async function rejectionOf(socket: { receive: AsyncIterable<unknown> }) {
      const received: unknown[] = [];
      const rejection = await (async () => {
        try {
          for await (const value of socket.receive) {
            received.push(value);
          }
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      return { received, rejection };
    }

    const stopsAfterTheEnd: [
      string,
      (
        socket: { close(): void },
        controller: AbortController,
      ) => void | Promise<void>,
    ][] = [
      ["close()", (socket) => socket.close()],
      ["an abort", (_socket, controller) => controller.abort()],
      [
        "a timeout abort",
        (_socket, controller) =>
          controller.abort(new DOMException("deadline", "TimeoutError")),
      ],
    ];

    test.each(stopsAfterTheEnd)(
      "should discard unread messages and end after %s on a session the peer closed",
      async (_name, stop) => {
        const { closed, controller, socket } = await openEndedSession("closed");

        await stop(socket, controller);
        const { received, rejection } = await rejectionOf(socket);

        expect(received).toEqual([]);
        expect(rejection).toBeUndefined();
        await expect(socket.closed).resolves.toBe(closed);
      },
    );

    test.each(stopsAfterTheEnd)(
      "should discard unread messages and still reject with the cause after %s on a session that failed",
      async (_name, stop) => {
        const { closed, controller, socket } = await openEndedSession("error");
        if (closed.kind !== "error") {
          throw new Error("expected an error ending");
        }

        await stop(socket, controller);
        const { received, rejection } = await rejectionOf(socket);

        expect(received).toEqual([]);
        expect(rejection).toBe(closed.cause);
        await expect(socket.closed).resolves.toBe(closed);
      },
    );

    test.each(["closed", "error"] as const)(
      "should discard unread messages after disposal on a session that ended as %s",
      async (ending) => {
        const { closed, socket } = await openEndedSession(ending);

        await socket[Symbol.asyncDispose]();
        const { received, rejection } = await rejectionOf(socket);

        expect(received).toEqual([]);
        expect(rejection).toBe(
          closed.kind === "error" ? closed.cause : undefined,
        );
        await expect(socket.closed).resolves.toBe(closed);
      },
    );

    test("should deliver unread messages before rejecting when the caller's signal expires with a timeout while the session is open", async () => {
      const controller = new AbortController();
      const { nativeSocket, socket } = await openNumberSession(
        controller.signal,
      );
      for (const value of [1, 2, 3]) {
        nativeSocket.receive(JSON.stringify(value));
      }
      await yieldMacrotask();

      controller.abort(new DOMException("deadline", "TimeoutError"));

      const closed = await socket.closed;
      if (closed.kind !== "error") {
        throw new Error("expected an error ending");
      }
      const { received, rejection } = await rejectionOf(socket);
      expect(received).toEqual([1, 2, 3]);
      expect(rejection).toBe(closed.cause);
    });

    test("should not listen to the caller's signal after the session ended and still discard when it aborts", async () => {
      const controller = new AbortController();
      const listeners = watchAbortListeners(controller.signal);
      const { nativeSocket, socket } = await openNumberSession(
        controller.signal,
      );
      nativeSocket.receive(JSON.stringify(1));
      await yieldMacrotask();
      nativeSocket.peerClose(1000);
      await socket.closed;
      expect(listeners.removed()).toBe(listeners.added());
      const added = listeners.added();

      controller.abort();

      await expect(drainReceive(socket)).resolves.toEqual([]);
      expect(listeners.added()).toBe(added);
    });

    test("should deliver queued messages and then end after a close from the peer", async () => {
      const { nativeSocket, socket } = await openNumberSession();
      for (const value of [1, 2, 3]) {
        nativeSocket.receive(JSON.stringify(value));
      }
      await yieldMacrotask();

      nativeSocket.peerClose(1000);

      await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
      await expect(drainReceive(socket)).resolves.toEqual([1, 2, 3]);
    });

    test("should discard unread messages and end at once after the caller closes the session", async () => {
      const { nativeSocket, socket } = await openNumberSession();
      for (const value of [1, 2, 3]) {
        nativeSocket.receive(JSON.stringify(value));
      }
      await yieldMacrotask();

      socket.close();

      await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
      await expect(drainReceive(socket)).resolves.toEqual([]);
    });

    test("should discard unread messages for a read made right after close() and drop frames that arrive during the closing handshake", async () => {
      const { nativeSocket, socket } = await openNumberSession();
      for (const value of [1, 2, 3]) {
        nativeSocket.receive(JSON.stringify(value));
      }
      await yieldMacrotask();

      socket.close();
      // The standard drops these once the socket is CLOSING, so they are dispatched raw to reach the session itself.
      nativeSocket.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(4) }),
      );
      const read = drainReceive(socket);
      nativeSocket.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(5) }),
      );

      await expect(read).resolves.toEqual([]);
      await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    });

    test("should discard unread messages and end at once after the caller disposes the session", async () => {
      const { nativeSocket, socket } = await openNumberSession();
      for (const value of [1, 2, 3]) {
        nativeSocket.receive(JSON.stringify(value));
      }
      await yieldMacrotask();

      await socket[Symbol.asyncDispose]();

      await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
      await expect(drainReceive(socket)).resolves.toEqual([]);
    });
  });

  test("should expose a single-consumer receive iterable and reject sends after terminal", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );

    socket.receive[Symbol.asyncIterator]();
    expect(() => socket.receive[Symbol.asyncIterator]()).toThrow(
      new TypeError("AsyncQueue supports one consumer"),
    );
    socket.close(1000, "done");
    await socket.closed;
    expect(() => socket.send({ type: "message", text: "late" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
  });

  test("should abort a blocked blob decode and wait for the message pump before disposal resolves", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    const blob = new Blob(['{"ok":true,"type":"known"}']);
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );

    nativeSocket.receive(blob);

    const disposed = Promise.resolve(socket[Symbol.asyncDispose]()).then(
      () => true,
      () => false,
    );
    await expect(disposed).resolves.toBe(true);

    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expectOnlyErrorSink(nativeSocket);
  });

  test("should preserve an observed remote close when disposal starts after a blocked message pump", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket),
      fake,
    );
    const nativeSocket = fake.last();
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    const blob = new Blob(['{"ok":true,"type":"known"}']);
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );

    nativeSocket.receive(blob);
    nativeSocket.peerClose(1000, "remote-finished");
    // The blocked pump keeps the attempt unsettled, so only `handleClose` has detached `error` so far.
    expectInertErrorListener(nativeSocket);

    const disposal = Promise.resolve(socket[Symbol.asyncDispose]()).then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(disposal).resolves.toEqual({ status: "resolved" });
    await expect(socket.closed).resolves.toEqual({
      code: 1000,
      kind: "closed",
      reason: "remote-finished",
      wasClean: true,
    });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expectOnlyErrorSink(nativeSocket);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("web socket incoming frame path", () => {
  const useSocket = defineWebSocket({
    incoming: struct.object({
      text: struct.string(),
      type: struct.literal("message"),
    }),
    path: "/ws/test",
  });

  function frame(text: string): string {
    return JSON.stringify({ text, type: "message" });
  }

  function textOf(message: unknown): string {
    if (!isTextMessage(message)) {
      throw new Error("expected a text message");
    }
    return message.text;
  }

  function isTextMessage(message: unknown): message is { text: string } {
    return (
      typeof message === "object" &&
      message !== null &&
      "text" in message &&
      typeof message.text === "string"
    );
  }

  function nextTurn(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function watchSettled(promise: Promise<unknown>): () => boolean {
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    return () => settled;
  }

  // A Blob whose bytes arrive when the test says so.
  function blobOf(bytes: Promise<ArrayBuffer>): Blob {
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(bytes);
    return blob;
  }

  // Junk before and after the frame: a decoder that ignores the view's window reads it and fails to parse.
  function windowed(
    text: string,
    createView: (
      buffer: ArrayBuffer,
      offset: number,
      byteLength: number,
    ) => ArrayBufferView,
  ) {
    const bytes = new TextEncoder().encode(text);
    const padding = 8;
    const buffer = new ArrayBuffer(padding + bytes.length + padding);
    new Uint8Array(buffer).fill(0x7a);
    new Uint8Array(buffer, padding, bytes.length).set(bytes);
    return createView(buffer, padding, bytes.length);
  }

  async function openFrameSession(options?: { signal?: AbortSignal }) {
    const fake = stubFakeWebSocket();
    const { session, socket } = await openSession(
      useSocket(createClient(withEndpoint("http://localhost"))(options)),
      fake,
    );
    return { native: socket, socket: session };
  }

  /** A message event whose data a platform socket would not deliver, from a handle that is not one. */
  function deliver(native: FakeWebSocket, data: unknown): void {
    native.dispatchEvent(new MessageEvent("message", { data }));
  }

  test("should not start reading a Blob frame that arrives during the closing handshake", async () => {
    const { native, socket } = await openFrameSession();
    const blob = new Blob(["not json"]);
    const read = vi.spyOn(blob, "arrayBuffer");

    socket.close();
    // The standard drops a message that arrives once the socket is no longer OPEN. A handle that dispatches it anyway
    // must not make the session start a read.
    deliver(native, blob);
    await socket.closed;
    await nextTurn();

    // A read nobody awaits would reject with no handler, and the frame is dropped anyway.
    expect(read).not.toHaveBeenCalled();
  });

  test.each([
    ["text", (json: string) => json],
    ["ArrayBuffer", (json: string) => new TextEncoder().encode(json).buffer],
    ["Uint8Array", (json: string) => new TextEncoder().encode(json)],
  ])(
    "should deliver %s frames within one microtask turn",
    async (_kind, createFrame) => {
      const { native, socket } = await openFrameSession();
      const pending = socket.receive[Symbol.asyncIterator]().next();
      const delivered = watchSettled(pending);

      deliver(native, createFrame(frame("now")));
      await Promise.resolve();

      // A frame that needs no read is decoded and queued without waiting for another turn.
      expect(delivered()).toBe(true);
      await expect(pending).resolves.toEqual({
        done: false,
        value: { text: "now", type: "message" },
      });
      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should deliver frames in arrival order while a Blob frame is still being read", async () => {
    const { native, socket } = await openFrameSession();
    const blobBytes = createDeferred<ArrayBuffer>();
    const received: string[] = [];
    const consumed = (async () => {
      for await (const message of socket.receive) {
        received.push(textOf(message));
      }
    })();

    native.receive(frame("a"));
    native.receive(blobOf(blobBytes.promise));
    native.receive(frame("c"));
    native.receive(new TextEncoder().encode(frame("d")).buffer);
    await nextTurn();

    // "c" and "d" need no read, but they arrived after the Blob and must not overtake it.
    expect(received).toEqual(["a"]);

    blobBytes.resolve(encodeMessage({ text: "b", type: "message" }));
    await vi.waitFor(() => expect(received).toEqual(["a", "b", "c", "d"]));

    socket.close(1000, "done");
    await consumed;
  });

  test.each([
    [
      "Uint8Array",
      (buffer: ArrayBuffer, offset: number, byteLength: number) =>
        new Uint8Array(buffer, offset, byteLength),
    ],
    [
      "DataView",
      (buffer: ArrayBuffer, offset: number, byteLength: number) =>
        new DataView(buffer, offset, byteLength),
    ],
    // Two bytes per element: the window is measured in bytes, not elements.
    [
      "Uint16Array",
      (buffer: ArrayBuffer, offset: number, byteLength: number) =>
        new Uint16Array(buffer, offset, byteLength / 2),
    ],
  ])(
    "should decode only the window of a %s frame",
    async (_kind, createView) => {
      const { native, socket } = await openFrameSession();
      const runtimeErrors: unknown[] = [];
      socket.onRuntimeError((error) => {
        runtimeErrors.push(error);
      });
      const pending = socket.receive[Symbol.asyncIterator]().next();

      // The two-byte view needs an even byte length. A trailing space pads it, and JSON ignores it.
      const json = frame("window");
      deliver(
        native,
        windowed(json.length % 2 === 0 ? json : `${json} `, createView),
      );

      await expect(pending).resolves.toEqual({
        done: false,
        value: { text: "window", type: "message" },
      });
      expect(runtimeErrors).toEqual([]);
      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should report each undecodable frame once and keep delivering the frames after it", async () => {
    const { native, socket } = await openFrameSession();
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((error) => {
      runtimeErrors.push(error);
    });
    const received: string[] = [];
    const consumed = (async () => {
      for await (const message of socket.receive) {
        received.push(textOf(message));
      }
    })();

    native.receive(frame("first"));
    native.receive("not json");
    deliver(native, new TextEncoder().encode('{"text":1,"type":"message"}'));
    native.receive(blobOf(Promise.resolve(encodeMessage({ type: "other" }))));
    native.receive(frame("last"));
    await vi.waitFor(() => expect(received).toEqual(["first", "last"]));

    // Text and byte frames fail as soon as they arrive, a Blob frame after its read. Each failure is reported once, in order.
    expect(runtimeErrors).toHaveLength(3);
    expect(runtimeErrors[0]).toBeInstanceOf(SyntaxError);
    expect(runtimeErrors[1]).toBeInstanceOf(StructError);
    expect(runtimeErrors[2]).toBeInstanceOf(StructError);
    expect(socket.state).toBe("open");

    socket.close(1000, "done");
    await consumed;
  });

  test("should settle promptly when the session is aborted while a Blob frame is being read", async () => {
    const controller = new AbortController();
    const { native, socket } = await openFrameSession({
      signal: controller.signal,
    });
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    native.receive(blobOf(new Promise<ArrayBuffer>(() => undefined)));
    native.receive(frame("behind the Blob"));
    const abortCause = new Error("owner aborted");
    controller.abort(abortCause);

    await expect(socket.closed).resolves.toMatchObject({
      cause: abortCause,
      kind: "aborted",
    });
    // Disposal waits for the message pump, which can only finish if the read was abandoned.
    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(pendingReceive).resolves.toBe(abortCause);
    expectOnlyErrorSink(native);
  });

  test("should drop the frames queued behind a Blob read when the session is disposed", async () => {
    const { native, socket } = await openFrameSession();
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();

    native.receive(blobOf(new Promise<ArrayBuffer>(() => undefined)));
    native.receive(frame("behind the Blob"));
    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();

    // Disposal abandons the read, and the frame that arrived after it is not decoded into the queue.
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should reject only disposal with TimeoutError when native close never arrives", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = useSocket(
      createClient(withEndpoint("http://localhost")),
    );

    await vi.waitFor(() => expect(fake.last()).toBeDefined());
    fake.last().open();
    const [, socket] = await executePromise;
    if (!socket || !fake.last()) {
      throw new Error("Expected socket");
    }
    const nativeSocket = fake.last();
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    const disposal = Promise.resolve(socket[Symbol.asyncDispose]()).then(
      () => ({ error: undefined, status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    let outcome: Awaited<typeof disposal> | undefined;
    void disposal.then((value) => {
      outcome = value;
    });
    await Promise.resolve();

    expect(nativeSocket.closeCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const result = await disposal;

    expect(result.status).toBe("rejected");
    expect(result.error).toBeInstanceOf(DOMException);
    expect(result.error).toMatchObject({
      message: "WebSocket close event was not observed before teardown timeout",
      name: "TimeoutError",
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(socket.state).toBe("closed");
    expectOnlyErrorSink(nativeSocket);
    expect(vi.getTimerCount()).toBe(0);
  });
});
