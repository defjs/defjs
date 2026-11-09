import { describe, expect, test, vi } from "vitest";
import type { Balancer, PickInfo, PickOutcome } from "./balancer";
import { outlierDetection } from "./outlier_detection";
import { pickEndpoint } from "./runtime";
import { yieldMacrotask } from "../../test/macrotask";

const info: PickInfo = { endpoints: ["https://a"] };

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
            get endpoint(): string {
              if (++endpointReads === 1) return "https://a";
              // @ts-expect-error a second read is intentionally not a string
              return 42;
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
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        },
      });

      const [fault] = pickEndpoint(
        {
          // @ts-expect-error a trapping outcome is not a pick tuple
          pick: () => outcome,
        },
        info,
      );

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
    const [fault] = pickEndpoint(
      {
        // @ts-expect-error a promise is not a pick tuple
        pick: () => returned,
      },
      info,
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(returned);
    await yieldMacrotask();
  });

  test("observes a rejected async done and finishes once", async () => {
    let calls = 0;
    const [fault, selected] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "https://a",
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- done is typed to return void; returning a rejected promise exercises the balancer's handling of an asynchronous completion failure
            done() {
              calls += 1;
              return Promise.reject(new Error("async done rejection"));
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
    await yieldMacrotask();
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
    const [fault] = pickEndpoint(
      {
        // @ts-expect-error a thenable is not a pick tuple
        pick: () => thenable,
      },
      info,
    );
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
    const [fault] = pickEndpoint(
      {
        // @ts-expect-error a callable thenable is not a pick tuple
        pick: () => thenable,
      },
      info,
    );
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

test("a rejected pick shape releases the probe slot that pick reserved", () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  try {
    let invalid = false;
    const child: Balancer = {
      pick(info): PickOutcome {
        const endpoint = info.endpoints[0] ?? "";
        // @ts-expect-error -- a non-function start is the invalid runtime shape under test
        if (invalid) return [null, { endpoint, start: 1 }];
        return [null, { endpoint }];
      },
    };
    const balancer = outlierDetection(child, {
      consecutiveFailures: 1,
      jitterRatio: 0,
    });
    const endpoints = ["https://a", "https://b"];
    pickEndpoint(balancer, { endpoints })[1]?.done({
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(pickEndpoint(balancer, { endpoints })[1]?.endpoint).toBe(
      "https://b",
    );
    vi.advanceTimersByTime(1000);
    invalid = true;
    expect(pickEndpoint(balancer, { endpoints })[0]?.code).toBe(
      "REQ_BUILD_FAILED",
    );
    invalid = false;
    expect(pickEndpoint(balancer, { endpoints })[1]?.endpoint).toBe(
      "https://a",
    );
  } finally {
    vi.useRealTimers();
  }
});

test("a throwing done on a rejected pick cannot replace the build fault", () => {
  const [fault, selected] = pickEndpoint(
    {
      pick: () => [
        null,
        {
          endpoint: "https://elsewhere",
          done() {
            throw new Error("done failed");
          },
        },
      ],
    },
    info,
  );
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(selected).toBeUndefined();
});
