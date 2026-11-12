import { describe, expect, test } from "vitest";
import {
  materializeOutboundRequest,
  runOutboundBuilder,
} from "../internal/outbound_request";
import { createBaseTransportRequest } from "./transport_request";

function build(
  transport: "http" | "sse",
  headers: unknown,
  defaultHeaders?: Headers,
) {
  return createBaseTransportRequest(
    "GET",
    "/headers",
    materializeOutboundRequest(
      runOutboundBuilder(undefined, () => ({ headers }), false),
      transport,
    ),
    {
      baseEndpoint: "https://api.example.com",
      defaultHeaders,
      signal: new AbortController().signal,
    },
  );
}

describe.each(["http", "sse"] as const)(
  "%s builder header entries",
  (transport) => {
    test("are converted by Headers", () => {
      const { headers } = build(transport, [
        [1, "named-by-number"],
        ["x-number", 1],
        ["x-tag", "a"],
        ["X-Tag", "b"],
      ]);

      expect(headers.get("1")).toBe("named-by-number");
      expect(headers.get("x-number")).toBe("1");
      expect(headers.get("x-tag")).toBe("a, b");
    });

    test.each([
      ["a string instead of a pair", ["ab"]],
      ["a pair with one item", [["x-missing"]]],
      ["a pair with three items", [["a", "1", "2"]]],
      ["a symbol value", [["x-symbol", Symbol("value")]]],
      ["an invalid name", [["bad name", "value"]]],
    ])("are rejected by Headers: %s", (_label, entries) => {
      expect(() => build(transport, entries)).toThrow(TypeError);
    });

    test("replace a default of the same name instead of appending to it", () => {
      const { headers } = build(
        transport,
        [
          ["X-Scope", "first"],
          ["x-scope", "second"],
        ],
        new Headers({ "X-Scope": "default", "X-Keep": "keep" }),
      );

      expect(headers.get("x-scope")).toBe("first, second");
      expect(headers.get("x-keep")).toBe("keep");
    });

    test("keep every Set-Cookie of an array or a Headers instance", () => {
      const entries: [string, string][] = [
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ];
      const defaults = new Headers([["set-cookie", "default=0"]]);

      expect(
        build(transport, entries, defaults).headers.getSetCookie(),
      ).toEqual(["a=1", "b=2"]);
      expect(
        build(transport, new Headers(entries), defaults).headers.getSetCookie(),
      ).toEqual(["a=1", "b=2"]);
    });

    test.each<[string, unknown, string]>([
      ["a string", "x", "x"],
      ["a number", 1, "1"],
      ["a boolean", true, "true"],
      ["a bigint", 10n, "10"],
      ["a Date", new Date(0), "1970-01-01T00:00:00.000Z"],
      ["null", null, "null"],
      ["an array", ["a", "b"], "a,b"],
      ["an empty array", [], ""],
    ])(
      "send a record value that is %s as its string conversion",
      (_label, value, expected) => {
        const { headers } = build(transport, { "x-value": value });

        expect(headers.get("x-value")).toBe(expected);
      },
    );

    test("leave out a record value that is undefined", () => {
      const { headers } = build(transport, {
        "x-keep": "1",
        "x-skip": undefined,
      });

      expect(headers.has("x-skip")).toBe(false);
      expect(headers.get("x-keep")).toBe("1");
    });

    test.each([
      ["an object", { nested: true }],
      ["an array of objects", [{ nested: true }]],
      ["a value Headers rejects", "line\nbreak"],
    ])(
      "reject a record value that cannot be a header value: %s",
      (_label, value) => {
        expect(() => build(transport, { "x-value": value })).toThrow(TypeError);
      },
    );

    test("let a record replace a default and keep every Set-Cookie", () => {
      const { headers } = build(
        transport,
        {
          "Set-Cookie": "a=1",
          "set-cookie": "b=2",
          "X-Scope": "first",
          "x-scope": "second",
        },
        new Headers([
          ["set-cookie", "default=0"],
          ["x-keep", "keep"],
          ["x-scope", "default"],
        ]),
      );

      expect(headers.get("x-scope")).toBe("first, second");
      expect(headers.getSetCookie()).toEqual(["a=1", "b=2"]);
      expect(headers.get("x-keep")).toBe("keep");
    });

    test("leave the defaults alone when a record only holds undefined", () => {
      const { headers } = build(
        transport,
        { "x-scope": undefined },
        new Headers({ "X-Scope": "default" }),
      );

      expect(headers.get("x-scope")).toBe("default");
    });

    test("leave the defaults alone when empty", () => {
      const { headers } = build(
        transport,
        [],
        new Headers({ "X-Scope": "default" }),
      );

      expect(headers.get("x-scope")).toBe("default");
    });
  },
);
