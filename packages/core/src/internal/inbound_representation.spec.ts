import { describe, expect, test } from "vitest";
import { struct } from "../struct";
import { resolveInboundRepresentation } from "./inbound_representation";

describe("inbound representation", () => {
  test("chooses the body kind from the struct", () => {
    expect(resolveInboundRepresentation(struct.string())).toBe("text");
    expect(resolveInboundRepresentation(struct.blob())).toBe("blob");
    expect(resolveInboundRepresentation(struct.file())).toBe("blob");
    expect(resolveInboundRepresentation(struct.arrayBuffer())).toBe(
      "arraybuffer",
    );
    expect(resolveInboundRepresentation(struct.number())).toBe("json");
  });

  test("rejects a value that is not a runtime struct", () => {
    expect(() =>
      // @ts-expect-error a plain object is not a struct
      resolveInboundRepresentation({}),
    ).toThrow(TypeError);
  });

  test("reads an inherited definition without requiring an own property", () => {
    const inherited: unknown = Object.create(struct.string());
    // @ts-expect-error Exercise the original lookup of a definition inherited through the prototype.
    expect(resolveInboundRepresentation(inherited)).toBe("text");
  });
});
