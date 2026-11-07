import { describe, expect, test, vi } from "vitest";
import { struct } from "../struct";
import { STRUCT } from "../struct/symbols";
import { parseEndpointInput } from "./endpoint_input";

describe("endpoint input helpers", () => {
  describe.each([
    { name: "unknown", schema: struct.unknown() },
    { name: "any", schema: struct.any() },
  ])("$name root input", ({ schema }) => {
    test.each(["pending", "resolving", "throwing getter", "Promise"] as const)(
      "returns %s data without reading or invoking then",
      (mode) => {
        const then = vi.fn((resolve: (value: unknown) => void) => {
          if (mode === "resolving") resolve("replacement");
        });
        const getter = vi.fn(() => {
          if (mode === "throwing getter")
            throw new Error("data getter must not run");
          return then;
        });
        const input =
          mode === "Promise"
            ? Promise.resolve("replacement")
            : Object.defineProperty({}, "then", { get: getter });

        const parsed: unknown = parseEndpointInput(schema, input);
        // Observe a rejected wrapper from the broken async implementation without awaiting input data.
        if (parsed !== input && parsed instanceof Promise)
          void parsed.catch(() => undefined);

        expect(parsed).toBe(input);
        expect(getter).not.toHaveBeenCalled();
        expect(then).not.toHaveBeenCalled();
      },
    );
  });

  test("should parse endpoint input and tag the parsed object with its struct", () => {
    const User = struct.object({
      id: struct.number(),
    });

    const parsed = parseEndpointInput(User, { id: 1 });
    expect(parsed.id).toBe(1);
    expect(Object.keys(parsed)).toEqual(["id"]);
    expect(STRUCT in parsed ? parsed[STRUCT] : undefined).toBe(User);
  });
});
