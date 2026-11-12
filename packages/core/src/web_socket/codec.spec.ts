import { describe, expect, test } from "vitest";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { resolveAbortCause } from "../internal/abort";
import { StructError, struct } from "../struct";
import {
  decodeWebSocketMessage,
  extractCloseInfo,
  serializeOutgoingWebSocketMessage,
} from "./codec";

describe("codec helpers", () => {
  test("extractCloseInfo extracts from CloseEvent", () => {
    const event = {
      code: 1000,
      reason: "normal",
      wasClean: true,
    };
    const info = extractCloseInfo(event);
    expect(info).toEqual({
      code: 1000,
      reason: "normal",
      wasClean: true,
    });
  });

  test("resolveAbortCause returns undefined when not aborted", () => {
    const signal = new AbortController().signal;
    expect(resolveAbortCause(signal)).toBeUndefined();
  });

  test("resolveAbortCause returns ERR_ABORTED for manual close", () => {
    const controller = new AbortController();
    controller.abort({ kind: "manual-web-socket-close" });
    const cause = resolveAbortCause(controller.signal);
    expect(cause).toBe(ERR_ABORTED);
  });

  test("resolveAbortCause returns ERR_TIMEOUT for timeout reason", () => {
    const controller = new AbortController();
    controller.abort(ERR_TIMEOUT);
    const cause = resolveAbortCause(controller.signal);
    expect(cause).toBe(ERR_TIMEOUT);
  });

  test("resolveAbortCause returns ERR_ABORTED for ERR_ABORTED reason", () => {
    const controller = new AbortController();
    controller.abort(ERR_ABORTED);
    const cause = resolveAbortCause(controller.signal);
    expect(cause).toBe(ERR_ABORTED);
  });

  test("resolveAbortCause classifies an explicit abort with a string reason as ABORTED", () => {
    const controller = new AbortController();
    controller.abort("some reason");
    const cause = resolveAbortCause(controller.signal);
    expect(cause).toBe(ERR_ABORTED);
  });

  test("resolveAbortCause handles DOMException timeout", () => {
    const controller = new AbortController();
    controller.abort(new DOMException("timeout", "TimeoutError"));
    const cause = resolveAbortCause(controller.signal);
    expect(cause).toBe(ERR_TIMEOUT);
  });

  test("resolveAbortCause maps another copy timeout sentinel to this ERR_TIMEOUT", () => {
    const foreign = new Error("Request timed out");
    Object.defineProperty(foreign, Symbol.for("defjs.cause.timeout"), {
      value: true,
    });
    const controller = new AbortController();
    controller.abort(foreign);
    expect(foreign).not.toBe(ERR_TIMEOUT);
    expect(resolveAbortCause(controller.signal)).toBe(ERR_TIMEOUT);
  });

  test("resolveAbortCause falls back to ERR_ABORTED when reason is undefined", () => {
    const signal = {};
    Object.setPrototypeOf(signal, AbortSignal.prototype);
    Object.defineProperty(signal, "aborted", { value: true });
    Object.defineProperty(signal, "reason", { value: undefined });
    if (!isAbortedSignal(signal)) {
      throw new Error("expected an aborted signal");
    }
    const cause = resolveAbortCause(signal);
    expect(cause).toBe(ERR_ABORTED);
  });

  test("resolveAbortCause treats a plain Error with a timeout-like message as ABORTED", () => {
    const controller = new AbortController();
    controller.abort(new Error(ERR_TIMEOUT.message));
    const cause = resolveAbortCause(controller.signal);
    expect(cause).toBe(ERR_ABORTED);
  });
});

describe("serializeOutgoingWebSocketMessage", () => {
  const outgoing = struct.object({
    text: struct.string().alias("message_text"),
    type: struct.literal("message"),
  });

  test("throws when the endpoint declares no outgoing struct", () => {
    expect(() =>
      serializeOutgoingWebSocketMessage(undefined, {
        text: "hello",
        type: "message",
      }),
    ).toThrow("No outgoing WebSocket messages are declared for this endpoint");
  });

  test("encodes aliases before JSON.stringify", () => {
    expect(
      serializeOutgoingWebSocketMessage(outgoing, {
        text: "hello",
        type: "message",
      }),
    ).toBe('{"message_text":"hello","type":"message"}');
  });

  test("throws when the outgoing value does not match the struct", () => {
    expect(() =>
      serializeOutgoingWebSocketMessage(outgoing, {
        text: 123,
        type: "message",
      }),
    ).toThrow(StructError);
  });

  test("rejects an outgoing value whose JSON serialization is undefined", () => {
    expect(() =>
      serializeOutgoingWebSocketMessage(struct.string().optional(), undefined),
    ).toThrow(
      new TypeError("Outgoing WebSocket message has no JSON representation"),
    );
  });

  test("encodes a nullable object field as JSON null", () => {
    const profile = struct.object({
      name: struct.string().alias("display_name"),
    });
    const outgoing = struct.object({ profile: profile.nullable() });

    expect(serializeOutgoingWebSocketMessage(outgoing, { profile: null })).toBe(
      '{"profile":null}',
    );
    expect(
      serializeOutgoingWebSocketMessage(outgoing, { profile: { name: "N" } }),
    ).toBe('{"profile":{"display_name":"N"}}');
  });

  test("encodes a finite number", () => {
    expect(serializeOutgoingWebSocketMessage(struct.number(), 1)).toBe("1");
  });

  test.each([
    [
      "Infinity",
      struct.number(),
      Number.POSITIVE_INFINITY,
      "is not JSON data: Infinity",
    ],
    ["NaN", struct.any(), Number.NaN, "is not JSON data: NaN"],
    ["Map", struct.any(), new Map([["k", 1]]), "is not JSON data: Map"],
    ["Set", struct.any(), new Set([1]), "is not JSON data: Set"],
    ["function", struct.any(), () => 1, "is not JSON data: function"],
    ["symbol", struct.any(), Symbol("wire"), "is not JSON data: symbol"],
    [
      "class instance",
      struct.any(),
      new (class Payload {})(),
      "is not JSON data: Payload",
    ],
  ])(
    "rejects a %s value instead of rewriting it",
    (_label, outgoing, message, fragment) => {
      expect(() =>
        serializeOutgoingWebSocketMessage(outgoing, message),
      ).toThrow(TypeError);
      expect(() =>
        serializeOutgoingWebSocketMessage(outgoing, message),
      ).toThrow(fragment);
    },
  );

  test("rejects a non-finite field and a non-plain field inside an object", () => {
    const numeric = struct.object({ n: struct.number() });
    const pocket = struct.object({ p: struct.any() });
    const mixed = struct.object({ fn: struct.any(), keep: struct.number() });

    expect(() =>
      serializeOutgoingWebSocketMessage(numeric, {
        n: Number.NEGATIVE_INFINITY,
      }),
    ).toThrow(
      'Outgoing WebSocket message field "n" is not JSON data: -Infinity',
    );
    expect(() =>
      serializeOutgoingWebSocketMessage(pocket, { p: new Map([["k", 1]]) }),
    ).toThrow('Outgoing WebSocket message field "p" is not JSON data: Map');
    expect(() =>
      serializeOutgoingWebSocketMessage(mixed, { fn: () => 1, keep: 1 }),
    ).toThrow(
      'Outgoing WebSocket message field "fn" is not JSON data: function',
    );
  });
});

describe("decodeWebSocketMessage", () => {
  const incoming = struct.object({
    text: struct.string().alias("message_text"),
    type: struct.literal("message"),
  });
  const json = '{"message_text":"hello","type":"message"}';
  const decoded = { text: "hello", type: "message" };

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

  test.each([
    ["text", () => json],
    ["ArrayBuffer", () => new TextEncoder().encode(json).buffer],
    ["Uint8Array", () => new TextEncoder().encode(json)],
    ["DataView", () => new DataView(new TextEncoder().encode(json).buffer)],
  ])("should decode %s frames without waiting", (_kind, createFrame) => {
    expect(decodeWebSocketMessage(incoming, createFrame())).toEqual(decoded);
  });

  test("should return a promise only for a Blob frame", async () => {
    const result = decodeWebSocketMessage(incoming, new Blob([json]));

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual(decoded);
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
  ])("should decode only the window of a %s view", (_kind, createView) => {
    // The two-byte view needs an even byte length. A trailing space pads it, and JSON ignores it.
    const frame = windowed(
      json.length % 2 === 0 ? json : `${json} `,
      createView,
    );

    expect(decodeWebSocketMessage(incoming, frame)).toEqual(decoded);
  });

  test("should throw at once when a text or byte frame cannot be decoded", () => {
    expect(() => decodeWebSocketMessage(incoming, "not json")).toThrow(
      SyntaxError,
    );
    expect(() =>
      decodeWebSocketMessage(incoming, '{"message_text":1,"type":"message"}'),
    ).toThrow(StructError);
    expect(() =>
      decodeWebSocketMessage(
        incoming,
        new TextEncoder().encode('{"type":"other"}'),
      ),
    ).toThrow(StructError);
  });

  test("should reject, not throw, when a Blob frame cannot be decoded", async () => {
    const result = decodeWebSocketMessage(incoming, new Blob(["not json"]));

    await expect(result).rejects.toBeInstanceOf(SyntaxError);
  });

  test.each([123, null, undefined, { type: "message" }])(
    "should return undefined for the frame %j, which carries no text",
    (frame) => {
      expect(decodeWebSocketMessage(incoming, frame)).toBeUndefined();
    },
  );
});

function isAbortedSignal(value: object): value is AbortSignal {
  return "aborted" in value && value.aborted === true && "reason" in value;
}
