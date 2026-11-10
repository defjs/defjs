import { afterEach, describe, expect, test, vi } from "vitest";
import type { PickInfo, PickOutcome } from "./balancer";
import { pickEndpoint } from "./runtime";
import { yieldMacrotask } from "../../test/macrotask";

const info: PickInfo = { endpoints: ["https://a"] };

afterEach(() => vi.unstubAllGlobals());

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

test("a rejected pick shape ends the pick that reserved state", () => {
  const done = vi.fn();
  const [fault, selected] = pickEndpoint(
    {
      pick: (): PickOutcome => [
        null,
        // @ts-expect-error -- a non-function start is the invalid runtime shape under test
        { endpoint: "https://a", start: 1, done },
      ],
    },
    info,
  );
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(selected).toBeUndefined();
  expect(done).toHaveBeenCalledExactlyOnceWith({ attempted: false });
});

test("a throwing done on a rejected pick cannot replace the build fault", () => {
  vi.stubGlobal("reportError", vi.fn());
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

describe("callback receiver and failure reporting", () => {
  test("calls start, end and done without a receiver", () => {
    const start = vi.fn();
    const end = vi.fn();
    const done = vi.fn();
    const [fault, selected] = pickEndpoint(
      { pick: () => [null, { endpoint: "https://a", start, end, done }] },
      info,
    );
    expect(fault).toBeNull();
    selected?.start();
    selected?.end({ attempted: true });
    selected?.done({ attempted: true });
    for (const callback of [start, end, done]) {
      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.contexts[0]).toBeUndefined();
    }
  });

  test("reports the TypeError of a method that relies on this", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    class Pick {
      readonly endpoint = "https://a";
      count = 0;
      done() {
        this.count++;
      }
    }
    const result = new Pick();
    const [fault, selected] = pickEndpoint(
      { pick: () => [null, result] },
      info,
    );
    expect(fault).toBeNull();
    expect(() => selected?.done({ attempted: true })).not.toThrow();
    expect(selected?.finished()).toBe(true);
    expect(result.count).toBe(0);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  test("releases a rejected pick without a receiver", () => {
    const done = vi.fn();
    const result = { endpoint: "https://elsewhere", done };
    const [fault] = pickEndpoint({ pick: () => [null, result] }, info);
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.contexts[0]).toBeUndefined();

    const invalid = { endpoint: "https://a", done, start: 1 };
    // @ts-expect-error a non-function start is the invalid runtime shape under test
    const [shape] = pickEndpoint({ pick: () => [null, invalid] }, info);
    expect(shape?.code).toBe("REQ_BUILD_FAILED");
    expect(done).toHaveBeenCalledTimes(2);
    expect(done.mock.contexts[1]).toBeUndefined();
  });

  test("reports a thrown start, end and done without changing the attempt", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const startError = new Error("start failed");
    const endError = new Error("end failed");
    const doneError = new Error("done failed");
    let doneCalls = 0;
    const [fault, selected] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "https://a",
            start() {
              throw startError;
            },
            end() {
              throw endError;
            },
            done() {
              doneCalls++;
              throw doneError;
            },
          },
        ],
      },
      info,
    );
    expect(fault).toBeNull();
    expect(() => {
      selected?.start();
      selected?.end({ attempted: true });
      selected?.done({ attempted: true });
      selected?.done({ attempted: true });
    }).not.toThrow();
    expect(selected?.finished()).toBe(true);
    expect(doneCalls).toBe(1);
    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls[0]?.[0]).toBe(startError);
    expect(report.mock.calls[1]?.[0]).toBe(endError);
    expect(report.mock.calls[2]?.[0]).toBe(doneError);
  });

  test("reports a thrown done on a rejected pick and keeps the build fault", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const cause = new Error("release failed");
    const [fault, selected] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "https://elsewhere",
            done() {
              throw cause;
            },
          },
        ],
      },
      info,
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(selected).toBeUndefined();
    expect(report).toHaveBeenCalledExactlyOnceWith(cause);
  });

  test("does not report returned rejections or non-conforming thenables", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const thenables = [
      () => Promise.reject(new Error("rejected")),
      () =>
        Object.defineProperty({}, "then", {
          get() {
            throw new Error("then getter");
          },
        }),
      () => ({
        then() {
          throw new Error("then call");
        },
      }),
    ];
    for (const returned of thenables) {
      const [, selected] = pickEndpoint(
        {
          pick: () => [
            null,
            {
              endpoint: "https://a",
              start: returned,
              end: returned,
              done: returned,
            },
          ],
        },
        info,
      );
      selected?.start();
      selected?.end({ attempted: true });
      selected?.done({ attempted: true });
    }
    await yieldMacrotask();
    expect(report).not.toHaveBeenCalled();
  });
});
