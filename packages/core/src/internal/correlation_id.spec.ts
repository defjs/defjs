import { afterEach, describe, expect, test, vi } from "vitest";
import { generateCorrelationId } from "./correlation_id";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("generateCorrelationId", () => {
  test("uses crypto.randomUUID when available", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(UUID_V4_RE);
    expect(generateCorrelationId()).not.toBe(id);
  });

  test("falls back to crypto.getRandomValues RFC 4122 v4 when randomUUID is absent", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(target: Uint8Array) {
        target.fill(0);
        return target;
      },
    });
    expect(generateCorrelationId()).toBe(
      "00000000-0000-4000-8000-000000000000",
    );

    vi.stubGlobal("crypto", {
      getRandomValues(target: Uint8Array) {
        target.fill(0xff);
        return target;
      },
    });
    expect(generateCorrelationId()).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    );
  });

  test("falls back to a unique monotonic id when globalThis.crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const first = generateCorrelationId();
    const second = generateCorrelationId();
    expect(first).toMatch(/^defjs-/);
    expect(second).toMatch(/^defjs-/);
    expect(second).not.toBe(first);
  });
});
