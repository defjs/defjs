import { expect, test } from "vitest";
import { createBrowserApiSetup } from "../../../../test/browser-api-server-setup.ts";
import type { StartedServer, StartupLayer } from "../fixture/startup.ts";

const globalSetupModule =
  await import("../../../../test/browser-api-server-setup.ts");

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
    const provided: Array<readonly [string, string, string]> = [];
    const servers: readonly StartedServer[] = [
      {
        origin: "http://127.0.0.1:31001",
        close() {
          closed.push("first");
          return Promise.resolve();
        },
      },
      {
        origin: "http://127.0.0.1:31002",
        close() {
          closed.push("second");
          return Promise.resolve();
        },
      },
    ];
    let nextServer = 0;
    const layer: StartupLayer = {
      runtime: "bun",
      upgradeWebSocket: () => {
        throw new Error("browser api setup does not upgrade");
      },
      startHttp() {
        const server = servers[nextServer];
        nextServer += 1;
        if (server === undefined) {
          throw new Error("unexpected startHttp call");
        }
        return Promise.resolve(server);
      },
      startRaw() {
        return Promise.reject(
          new Error("browser api setup does not start raw"),
        );
      },
      reserveRefusedOrigin() {
        return Promise.reject(
          new Error("browser api setup does not reserve a port"),
        );
      },
    };
    const setup = createBrowserApiSetup(() => Promise.resolve(layer));

    async function setupProject(name: string) {
      const returnedCleanup = await setup({
        provide(key, value) {
          provided.push([name, key, value]);
        },
      });
      if (typeof returnedCleanup !== "function") {
        throw new TypeError("Expected a global setup cleanup function");
      }
      return returnedCleanup;
    }

    expect(Reflect.get(globalSetupModule, "teardown")).toBeUndefined();

    const first = await setupProject("first");
    const second = await setupProject("second");
    expect(provided).toEqual([
      ["first", "testServerHost", "http://127.0.0.1:31001"],
      ["second", "testServerHost", "http://127.0.0.1:31002"],
    ]);
    expect(provided.map((entry) => entry[1])).toEqual([
      "testServerHost",
      "testServerHost",
    ]);
    expect(closed).toEqual([]);

    await (reverse ? second : first)();
    const afterFirst = [...closed];
    await (reverse ? first : second)();
    expect([afterFirst, closed]).toEqual([[firstClosed], allClosed]);
  },
);
