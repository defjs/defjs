import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./api-reference.json");
  vi.resetModules();
});

test("an API entry with an unknown kind fails at load time", async () => {
  vi.resetModules();
  vi.doMock("./api-reference.json", () => ({
    default: [{ slug: "core/enum-thing", kind: "enum" }],
  }));
  await expect(import("./api-reference")).rejects.toThrow(
    'Unknown API kind "enum" for core/enum-thing',
  );
});
