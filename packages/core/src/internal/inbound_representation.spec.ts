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
    expect(() => resolveInboundRepresentation({})).toThrow(TypeError);
  });
});
