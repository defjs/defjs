import { setImmediate } from "node:timers/promises";
import { describe, expect, test, vi } from "vitest";
import type { EndpointPickInfo } from "./balancer";
import { pickEndpoint } from "./runtime";

const info: EndpointPickInfo = { endpoints: ["https://a"], transport: "http" };

describe("pick outcome normalization", () => {
  test.each(["endpoint", "done"])("contains a throwing %s getter", (field) => {
    const cause = new Error(`${field} getter`);
    const done = vi.fn();
    const result = { endpoint: "https://a", done };
    Object.defineProperty(result, field, {
      get() {
        throw cause;
      },
    });

    const [fault, selected] = pickEndpoint(
      { pick: () => [null, result] },
      info,
    );

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(cause);
    expect(selected).toBeUndefined();
    expect(done).not.toHaveBeenCalled();
  });

  test("snapshots endpoint and done exactly once", () => {
    let endpointReads = 0;
    let doneReads = 0;
    const done = vi.fn();
    const [fault, selected] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            get endpoint() {
              return ++endpointReads === 1 ? "https://a" : (42 as never);
            },
            get done() {
              return ++doneReads === 1 ? done : undefined;
            },
          },
        ],
      },
      info,
    );

    expect(fault).toBeNull();
    expect(selected?.endpoint).toBe("https://a");
    selected?.done({ attempted: false });
    expect(done).toHaveBeenCalledExactlyOnceWith({ attempted: false });
    expect(endpointReads).toBe(1);
    expect(doneReads).toBe(1);
  });

  test.each(["length", "0", "1"])(
    "contains a throwing outcome index/trap %s",
    (key) => {
      const cause = new Error(`outcome ${key}`);
      const outcome = new Proxy([null, { endpoint: "https://a" }], {
        get(target, property, receiver) {
          if (property === key) {
            throw cause;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const [fault] = pickEndpoint({ pick: () => outcome as never }, info);

      expect(fault?.code).toBe("REQ_BUILD_FAILED");
      expect(fault?.cause).toBe(cause);
    },
  );

  test("contains a throwing result Proxy trap", () => {
    const cause = new Error("result trap");
    const done = vi.fn();
    const result = new Proxy(
      { endpoint: "https://a", done },
      {
        has() {
          throw cause;
        },
        get() {
          throw cause;
        },
      },
    );

    const [fault] = pickEndpoint({ pick: () => [null, result] }, info);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(cause);
    expect(done).not.toHaveBeenCalled();
  });
});

describe("synchronous balancer callbacks", () => {
  test("observes a rejected async pick without awaiting it", async () => {
    const cause = new Error("async pick rejection");
    const returned = Promise.reject(cause);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const [fault] = pickEndpoint({ pick: () => returned as never }, info);
      expect(fault?.code).toBe("REQ_BUILD_FAILED");
      expect(fault?.cause).toBe(returned);
      await setImmediate();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("observes a rejected async done and finishes once", async () => {
    let calls = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const [fault, selected] = pickEndpoint(
        {
          pick: () => [
            null,
            {
              endpoint: "https://a",
              async done() {
                calls += 1;
                throw new Error("async done rejection");
              },
            },
          ],
        },
        info,
      );
      expect(fault).toBeNull();
      selected?.done({ attempted: true, status: 200 });
      selected?.done({ attempted: false });
      expect(selected?.finished()).toBe(true);
      expect(calls).toBe(1);
      await setImmediate();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("observes custom thenables with their receiver and only a rejection handler", () => {
    const observations: unknown[][] = [];
    const thenable = {
      then(
        this: unknown,
        fulfilled: unknown,
        rejected: (reason: unknown) => void,
      ) {
        observations.push([this, fulfilled, typeof rejected]);
        rejected(new Error("custom rejection"));
      },
    };
    const [fault] = pickEndpoint({ pick: () => thenable as never }, info);
    expect(fault?.cause).toBe(thenable);
    const [, selected] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "https://a",
            done: () => thenable,
          },
        ],
      },
      info,
    );
    selected?.done({ attempted: false });
    expect(observations).toEqual([
      [thenable, undefined, "function"],
      [thenable, undefined, "function"],
    ]);
  });

  test("observes callable thenables and ignores non-callable then fields", () => {
    let observations = 0;
    const thenable = Object.assign(() => undefined, {
      then(_fulfilled: undefined, rejected: (reason: unknown) => void) {
        observations += 1;
        rejected("ignored");
      },
    });
    const [fault] = pickEndpoint({ pick: () => thenable as never }, info);
    expect(fault?.cause).toBe(thenable);
    expect(observations).toBe(1);
    for (const returned of [null, 42, { then: 42 }]) {
      const [, selected] = pickEndpoint(
        {
          pick: () => [
            null,
            {
              endpoint: "https://a",
              done: () => returned,
            },
          ],
        },
        info,
      );
      expect(() => selected?.done({ attempted: false })).not.toThrow();
    }
  });

  test.each(["get", "call"])(
    "ignores a throw from a done thenable's %s",
    (phase) => {
      const thenable = {
        get then() {
          if (phase === "get") {
            throw new Error("then getter");
          }
          return () => {
            throw new Error("then call");
          };
        },
      };
      const [, selected] = pickEndpoint(
        {
          pick: () => [
            null,
            {
              endpoint: "https://a",
              done: () => thenable,
            },
          ],
        },
        info,
      );
      expect(() => selected?.done({ attempted: false })).not.toThrow();
      expect(selected?.finished()).toBe(true);
    },
  );
});
