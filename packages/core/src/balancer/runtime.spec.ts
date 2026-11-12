import { afterEach, describe, expect, test, vi } from "vitest";
import type { PickInfo } from "./balancer";
import { pickEndpoint } from "./runtime";

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
    expect(result.count).toBe(0);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
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
    expect(doneCalls).toBe(1);
    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls[0]?.[0]).toBe(startError);
    expect(report.mock.calls[1]?.[0]).toBe(endError);
    expect(report.mock.calls[2]?.[0]).toBe(doneError);
  });
});
