import { afterEach, expect, test, vi } from "vitest";
import { startHonoTestServer } from "../../../../test/hono-test-server";

vi.mock("../../../../test/hono-test-server", () => ({
  startHonoTestServer: vi.fn(),
}));

const globalSetup = await import("../../../../test/browser-api-server-setup");

afterEach(() => {
  vi.mocked(startHonoTestServer).mockReset();
  vi.restoreAllMocks();
});

test.each([
  {
    order: "normal",
    reverse: false,
    firstClosed: "first",
    allClosed: ["first", "second"],
  },
  {
    order: "reverse",
    reverse: true,
    firstClosed: "second",
    allClosed: ["second", "first"],
  },
])(
  "each browser setup closes only its own server in $order order",
  async ({ reverse, firstClosed, allClosed }) => {
    const closed: string[] = [];
    const provided = new Map<string, unknown>();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(startHonoTestServer)
      .mockResolvedValueOnce({
        host: "http://127.0.0.1:31001",
        async close() {
          closed.push("first");
        },
      })
      .mockResolvedValueOnce({
        host: "http://127.0.0.1:31002",
        async close() {
          closed.push("second");
        },
      });

    async function setupProject(name: string) {
      const returnedCleanup = await globalSetup.setup({
        provide(key, value) {
          provided.set(`${name}:${key}`, value);
        },
      });
      // Vitest prefers an exported teardown over a cleanup returned by setup.
      const cleanup: unknown =
        Reflect.get(globalSetup, "teardown") ?? returnedCleanup;
      if (typeof cleanup !== "function") {
        throw new TypeError("Expected a global setup cleanup function");
      }
      return cleanup;
    }

    const first = await setupProject("first");
    const second = await setupProject("second");
    expect([...provided]).toEqual([
      ["first:testServerHost", "http://127.0.0.1:31001"],
      ["second:testServerHost", "http://127.0.0.1:31002"],
    ]);
    expect(closed).toEqual([]);

    await (reverse ? second : first)();
    const afterFirst = [...closed];
    await (reverse ? first : second)();
    expect([afterFirst, closed]).toEqual([[firstClosed], allClosed]);
  },
);
