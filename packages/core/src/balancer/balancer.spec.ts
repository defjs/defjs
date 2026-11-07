import { afterEach, describe, expect, test, vi } from "vitest";
import { CLIENT, createClient } from "../client/client";
import { createClientConfig } from "../client/config";
import { withEndpoint, withBalancer } from "../client/option";
import { defineRequest } from "../http";
import { defineEventStream } from "../sse";
import { struct } from "../struct";
import { defineWebSocket } from "../web_socket";
import {
  type Balancer,
  type DoneInfo,
  type PickInfo,
  ERR_NO_CANDIDATE,
  isNoCandidateCause,
  pickFirstBalancer,
  roundRobinBalancer,
} from "./balancer";
import { pickEndpoint, type ResolvedEndpoint } from "./runtime";

afterEach(() => {
  vi.restoreAllMocks();
});

function info(endpoints: readonly string[]): PickInfo {
  return { endpoints, operation: "getOrder" };
}

function endpointOf(balancer: Balancer, endpoints: readonly string[]): string {
  const [error, result] = balancer.pick(info(endpoints));
  if (error !== null || result === undefined) {
    throw error ?? new Error("missing endpoint");
  }
  return result.endpoint;
}

function report(
  balancer: Balancer,
  endpoints: readonly string[],
  done: DoneInfo,
): void {
  const [, result] = balancer.pick(info(endpoints));
  result?.done?.(done);
}

describe("isNoCandidateCause", () => {
  test("recognizes the sentinel and a branded error from another copy", () => {
    const foreign = new Error("foreign");
    Object.defineProperty(foreign, Symbol.for("defjs.cause.no-endpoint"), {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });

    expect(isNoCandidateCause(ERR_NO_CANDIDATE)).toBe(true);
    expect(isNoCandidateCause(foreign)).toBe(true);
    expect(foreign).not.toBe(ERR_NO_CANDIDATE);
    expect(ERR_NO_CANDIDATE.message).toBe("No endpoint available");
    expect(
      Object.getOwnPropertyDescriptor(
        ERR_NO_CANDIDATE,
        Symbol.for("defjs.cause.no-endpoint"),
      )?.enumerable,
    ).toBe(false);
    expect(isNoCandidateCause(new Error("No endpoint available"))).toBe(false);
    expect(isNoCandidateCause(null)).toBe(false);
    expect(isNoCandidateCause("ERR_NO_CANDIDATE")).toBe(false);
    expect(isNoCandidateCause({})).toBe(false);
  });
});

describe("pickFirstBalancer", () => {
  test("sticks to the first endpoint and moves only after NET_UNREACHABLE", () => {
    const balancer = pickFirstBalancer();
    const [error, result] = balancer.pick(info(["https://a", "https://b"]));

    expect(error).toBeNull();
    expect(result?.endpoint).toBe("https://a");
    expect(typeof result?.done).toBe("function");
    result?.done?.({ attempted: true, status: 204 });
    expect(endpointOf(balancer, ["https://a", "https://b"])).toBe("https://a");

    for (const done of [
      { attempted: false },
      { attempted: true, code: "NET_TIMEOUT" as const },
      { attempted: true, code: "NET_BODY_INCOMPLETE" as const },
      { attempted: true, code: "NET_SERVER_ERROR" as const },
    ]) {
      const current = pickFirstBalancer();
      report(current, ["https://a", "https://b"], done);
      expect(endpointOf(current, ["https://a", "https://b"])).toBe("https://a");
    }

    report(balancer, ["https://a", "https://b"], {
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(endpointOf(balancer, ["https://a", "https://b"])).toBe("https://b");
    report(balancer, ["https://a", "https://b"], {
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(endpointOf(balancer, ["https://a", "https://b"])).toBe("https://a");
  });

  test("advances one step when overlapping calls fail together", () => {
    const balancer = pickFirstBalancer();
    const first = balancer.pick(info(["a", "b", "c"]));
    const second = balancer.pick(info(["a", "b", "c"]));
    expect(first[1]?.endpoint).toBe("a");
    expect(second[1]?.endpoint).toBe("a");

    first[1]?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
    second[1]?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
    expect(endpointOf(balancer, ["a", "b", "c"])).toBe("b");
  });

  test("stays on a single endpoint and resets when the sticky endpoint leaves", () => {
    const balancer = pickFirstBalancer();
    report(balancer, ["only"], {
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(endpointOf(balancer, ["only"])).toBe("only");

    report(balancer, ["a", "b"], {
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(endpointOf(balancer, ["b", "c"])).toBe("b");
    expect(endpointOf(balancer, ["c"])).toBe("c");
  });

  test("does not advance onto an empty slot", () => {
    const balancer = pickFirstBalancer();
    const endpoints = ["a"];
    endpoints.length = 2;
    report(balancer, endpoints, {
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(endpointOf(balancer, ["a", "b"])).toBe("a");

    const empty: string[] = [];
    empty.length = 1;
    expect(balancer.pick(info(empty))[0]).toBe(ERR_NO_CANDIDATE);
  });

  test("returns ERR_NO_CANDIDATE for an empty list without modifying it", () => {
    const endpoints = Object.freeze<string[]>([]);
    const balancer = pickFirstBalancer({ shuffle: false });
    expect(balancer.pick(info(endpoints))[0]).toBe(ERR_NO_CANDIDATE);
    expect(endpoints).toEqual([]);
  });

  test("keeps shuffle keys and does not reorder the caller's list", () => {
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.4);
    const endpoints = ["a", "b", "c"];
    const balancer = pickFirstBalancer({ shuffle: true });

    expect(endpointOf(balancer, endpoints)).toBe("b");
    expect(endpoints).toEqual(["a", "b", "c"]);
    expect(endpointOf(balancer, ["a", "c"])).toBe("c");
    expect(random).toHaveBeenCalledTimes(3);
  });

  test("keeps configuration order when shuffle keys tie", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const balancer = pickFirstBalancer({ shuffle: true });
    expect(endpointOf(balancer, ["a", "b"])).toBe("a");
    expect(endpointOf(balancer, ["a", "b"])).toBe("a");
  });

  test("skips an empty shuffle slot", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.2).mockReturnValueOnce(0.8);
    const endpoints = ["b", "a"];
    // @ts-expect-error a hole is not a string endpoint
    endpoints.splice(1, 0, undefined);
    const balancer = pickFirstBalancer({ shuffle: true });
    expect(endpointOf(balancer, endpoints)).toBe("b");
  });

  test("remembers an invalid option and does not throw", () => {
    // @ts-expect-error null is not pick-first options
    expect(() => pickFirstBalancer(null)).not.toThrow();
    // @ts-expect-error shuffle must be a boolean
    const balancer = pickFirstBalancer({ shuffle: "yes" });
    const [first] = balancer.pick(info([]));
    const [second] = balancer.pick(info(["a"]));
    expect(first).toBeInstanceOf(TypeError);
    expect(first).toBe(second);
    expect(
      // @ts-expect-error a number is not pick-first options
      pickFirstBalancer(1).pick(info(["a"]))[0],
    ).toBeInstanceOf(TypeError);
  });

  test("rejects an array as options", () => {
    // @ts-expect-error an array is not pick-first options
    const error = pickFirstBalancer([]).pick(info(["a"]))[0];
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toBe("pickFirstBalancer options must be an object");
  });
});

describe("roundRobinBalancer", () => {
  test("starts at a random counter and wraps at 2^32", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const balancer = roundRobinBalancer({ outlierDetection: false });
    expect(endpointOf(balancer, ["a", "b"])).toBe("a");
    expect(endpointOf(balancer, ["a", "b"])).toBe("b");
    expect(balancer.pick(info(["a"]))[1]?.done).toBeUndefined();

    random.mockReturnValue(0xffffffff / 0x100000000);
    const wrapped = roundRobinBalancer({ outlierDetection: false });
    expect(endpointOf(wrapped, ["a", "b"])).toBe("b");
    expect(endpointOf(wrapped, ["a", "b"])).toBe("a");

    random.mockReturnValue(0);
    const hole = ["a"];
    hole.length = 2;
    const sparse = roundRobinBalancer({ outlierDetection: false });
    expect(sparse.pick(info(hole))[1]?.endpoint).toBe("a");
    expect(sparse.pick(info(hole))[0]).toBe(ERR_NO_CANDIDATE);
  });

  test("does not share counters between instances", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = roundRobinBalancer();
    const second = roundRobinBalancer();
    expect(endpointOf(first, ["a", "b"])).toBe("a");
    expect(endpointOf(second, ["a", "b"])).toBe("a");
  });

  test("uses smooth weighting and ignores weights outside the list", () => {
    const balancer = roundRobinBalancer({
      weights: new Map([
        ["a", 2],
        ["b", 1],
        ["z", 100],
      ]),
    });
    const fresh = ["a", "b", "a", "a", "b", "a"];
    expect(fresh.map(() => endpointOf(balancer, ["a", "b"]))).toEqual(fresh);

    const equal = roundRobinBalancer({ weights: new Map() });
    expect(
      ["a", "b", "a", "b"].map(() => endpointOf(equal, ["a", "b"])),
    ).toEqual(["a", "b", "a", "b"]);

    const unlisted = roundRobinBalancer({ weights: new Map([["a", 2]]) });
    expect(["a", "c", "a"].map(() => endpointOf(unlisted, ["a", "c"]))).toEqual(
      ["a", "c", "a"],
    );
  });

  test("drops current weight when an endpoint leaves the list", () => {
    const balancer = roundRobinBalancer({
      weights: new Map([
        ["a", 1],
        ["b", 3],
      ]),
    });
    expect(endpointOf(balancer, ["a", "b"])).toBe("b");
    expect(endpointOf(balancer, ["a"])).toBe("a");
    expect(endpointOf(balancer, ["a", "b"])).toBe("b");
  });

  test("keeps a member's current weight while one pick leaves it out", () => {
    const balancer = roundRobinBalancer({
      weights: new Map([
        ["a", 1],
        ["b", 3],
      ]),
    });
    expect(endpointOf(balancer, ["a", "b"])).toBe("b");
    expect(
      balancer.pick({ endpoints: ["a"], members: ["a", "b"] })[1]?.endpoint,
    ).toBe("a");
    expect(endpointOf(balancer, ["a", "b"])).toBe("a");
  });

  test("copies weights at construction", () => {
    const weights = new Map([
      ["a", 1],
      ["b", 100],
    ]);
    const balancer = roundRobinBalancer({ weights });
    weights.set("a", 100);
    weights.set("b", 1);
    expect(endpointOf(balancer, ["a", "b"])).toBe("b");
    const endpoints = Object.freeze(["a", "b"]);
    expect(endpointOf(balancer, endpoints)).toBe("b");
    expect(endpoints).toEqual(["a", "b"]);
  });

  test("returns ERR_NO_CANDIDATE for an empty list", () => {
    expect(roundRobinBalancer().pick(info([]))[0]).toBe(ERR_NO_CANDIDATE);
    expect(roundRobinBalancer({}).pick(info([]))[0]).toBe(ERR_NO_CANDIDATE);
  });

  test("remembers invalid options and does not throw", () => {
    const random = vi.spyOn(Math, "random");
    // @ts-expect-error null is not round-robin options
    expect(() => roundRobinBalancer(null)).not.toThrow();
    const cases = [
      // @ts-expect-error a number is not round-robin options
      roundRobinBalancer(1),
      // @ts-expect-error weights must be a map of finite numbers
      roundRobinBalancer({ weights: {} }),
      roundRobinBalancer({
        // @ts-expect-error weight keys must be endpoint strings
        weights: new Map([[1, 1]]),
      }),
      roundRobinBalancer({
        // @ts-expect-error weight values must be finite numbers
        weights: new Map([["a", "1"]]),
      }),
      roundRobinBalancer({ weights: new Map([["a", Number.NaN]]) }),
      roundRobinBalancer({
        weights: new Map([["a", Number.POSITIVE_INFINITY]]),
      }),
      roundRobinBalancer({ weights: new Map([["a", 0]]) }),
      roundRobinBalancer({ weights: new Map([["a", -1]]) }),
    ];
    for (const balancer of cases) {
      const [first] = balancer.pick(info(["a"]));
      const [second] = balancer.pick(info([]));
      expect(first).toBeInstanceOf(Error);
      expect(first).toBe(second);
    }
    expect(cases[0]?.pick(info(["a"]))[0]).toBeInstanceOf(TypeError);
    expect(cases[1]?.pick(info(["a"]))[0]).toBeInstanceOf(TypeError);
    expect(cases[2]?.pick(info(["a"]))[0]).toBeInstanceOf(TypeError);
    expect(cases[3]?.pick(info(["a"]))[0]).toBeInstanceOf(TypeError);
    expect(cases[4]?.pick(info(["a"]))[0]).toBeInstanceOf(RangeError);
    expect(random).not.toHaveBeenCalled();
  });

  test("rejects an array as options", () => {
    // @ts-expect-error an array is not round-robin options
    const error = roundRobinBalancer([]).pick(info(["a"]))[0];
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toBe("roundRobinBalancer options must be an object");
  });
});

describe("endpoint configuration", () => {
  test("copies, dedupes, and replaces endpoints without touching the balancer", () => {
    const config = createClientConfig();
    const balancer = config.balancer;
    const list = ["https://a", "https://a", "https://b", "not a url"];
    withEndpoint(...list)(config);
    list.push("https://c");
    expect(config.endpoints).toEqual(["https://a", "https://b", "not a url"]);
    expect(config.balancer).toBe(balancer);

    withEndpoint()(config);
    expect(config.endpoints).toEqual([]);
    withEndpoint("https://c", "https://c")(config);
    expect(config.endpoints).toEqual(["https://c"]);
    expect(config.balancer).toBe(balancer);
  });

  test("stores the balancer by reference and gives each client its own", () => {
    const balancer = pickFirstBalancer();
    const config = createClientConfig();
    withBalancer(balancer)(config);
    withEndpoint("https://a", "https://b")(config);
    expect(config.balancer).toBe(balancer);

    const first = createClient(withEndpoint("https://a", "https://b"));
    const second = createClient(withEndpoint("https://a", "https://b"));
    expect(first[CLIENT].config.balancer).not.toBe(
      second[CLIENT].config.balancer,
    );
    const picked = first[CLIENT].config.balancer.pick(
      info(first[CLIENT].config.endpoints),
    );
    expect(picked[1]?.endpoint).toBe("https://a");
    expect(typeof picked[1]?.done).toBe("function");
    picked[1]?.done?.({ attempted: true, code: "NET_UNREACHABLE" });
    expect(
      first[CLIENT].config.balancer.pick(
        info(first[CLIENT].config.endpoints),
      )[1]?.endpoint,
    ).toBe("https://b");
    expect(
      second[CLIENT].config.balancer.pick(
        info(second[CLIENT].config.endpoints),
      )[1]?.endpoint,
    ).toBe("https://a");
  });
});

describe("transitional endpoint selection", () => {
  test("passes an empty base when the client has no endpoints", async () => {
    const client = createClient();
    const [httpError] = await defineRequest({ method: "GET", path: "/x" })(
      client,
    );
    const [sseError] = await defineEventStream({
      events: { tick: struct.string() },
      path: "/events",
    })(client);
    const [wsError] = await defineWebSocket({
      incoming: struct.object({}),
      maxIncomingQueueSize: 1,
      path: "/ws",
    })(client);

    expect(httpError?.code).toBe("REQ_BUILD_FAILED");
    expect(sseError?.code).toBe("REQ_BUILD_FAILED");
    expect(wsError?.code).toBe("REQ_BUILD_FAILED");
  });
});

describe("pickEndpoint", () => {
  const base = info(["https://a", "https://b"]);

  test("maps option errors, empty lists, and thrown or malformed picks", () => {
    // @ts-expect-error shuffle must be a boolean
    const invalid = pickFirstBalancer({ shuffle: 1 });
    const [optionsFault] = pickEndpoint(invalid, base);
    expect(optionsFault?.code).toBe("REQ_OPTIONS_INVALID");
    expect(optionsFault?.cause).toBe(invalid.pick(base)[0]);

    const [emptyFault] = pickEndpoint(pickFirstBalancer(), info([]));
    expect(emptyFault?.code).toBe("REQ_BUILD_FAILED");
    expect(emptyFault?.cause).toBe(ERR_NO_CANDIDATE);

    const plain = new Error("custom");
    const [plainFault] = pickEndpoint({ pick: () => [plain, undefined] }, base);
    expect(plainFault?.code).toBe("REQ_BUILD_FAILED");
    expect(plainFault?.cause).toBe(plain);

    const thrown = new Error("boom");
    expect(
      pickEndpoint(
        {
          pick() {
            throw thrown;
          },
        },
        base,
      )[0],
    ).toMatchObject({ cause: thrown, code: "REQ_BUILD_FAILED" });
    expect(
      pickEndpoint(
        {
          pick() {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- pick() under test throws a string primitive to exercise how pickEndpoint handles a non-Error throw
            throw "boom";
          },
        },
        base,
      )[0]?.cause,
    ).toBe("boom");

    let called = false;
    const returned = [
      new Error("shape"),
      {
        done() {
          called = true;
        },
      },
    ] as const;
    const malformed = [
      null,
      { 0: null, length: 2 },
      [],
      [null],
      [null, null, "extra"],
      [1, undefined],
      [new Error("extra"), 1],
      [undefined, { endpoint: "a" }],
      [null, null],
      [null, 1],
      [null, { endpoint: 1 }],
      [null, { done: "no" }],
      [null, { endpoint: "a", done: "no" }],
      returned,
    ];
    for (const outcome of malformed) {
      const [fault] = pickEndpoint(
        {
          // @ts-expect-error malformed pick results are rejected at runtime
          pick: () => outcome,
        },
        base,
      );
      expect(fault?.code).toBe("REQ_BUILD_FAILED");
    }
    const [shapeFault] = pickEndpoint(
      {
        // @ts-expect-error a non-tuple pick result is rejected at runtime
        pick: () => returned,
      },
      base,
    );
    expect(shapeFault?.cause).toBe(returned);
    expect(called).toBe(false);
  });

  test("keeps an Error-tagged throwable from another realm as the build-failure cause", () => {
    const foreign: unknown = {
      [Symbol.toStringTag]: "Error",
      message: "x",
    };
    expect(foreign).not.toBeInstanceOf(Error);
    const [fault] = pickEndpoint(
      {
        // @ts-expect-error a cross-realm error is not this realm's Error
        pick: () => [foreign, undefined],
      },
      base,
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(foreign);
  });

  test("calls done at most once and swallows a throw", () => {
    let calls = 0;
    let nested = 0;
    let picked: ResolvedEndpoint | undefined;
    const [error, selected] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "https://a",
            done(doneInfo: DoneInfo) {
              calls += 1;
              expect(doneInfo).toEqual({
                attempted: true,
                code: "NET_UNREACHABLE",
              });
              nested = calls;
              picked?.done({ attempted: false });
              return 1;
            },
          },
        ],
      },
      base,
    );
    picked = selected;
    expect(error).toBeNull();
    expect(picked?.finished()).toBe(false);
    expect(() =>
      picked?.done({ attempted: true, code: "NET_UNREACHABLE" }),
    ).not.toThrow();
    expect(calls).toBe(1);
    expect(nested).toBe(1);
    expect(picked?.finished()).toBe(true);
    picked?.done({ attempted: false });
    expect(calls).toBe(1);

    const [roundError, round] = pickEndpoint(roundRobinBalancer(), base);
    expect(roundError).toBeNull();
    expect(() => round?.done({ attempted: false })).not.toThrow();
    expect(round?.finished()).toBe(true);
    round?.done({ attempted: true, status: 200 });

    let exploded = 0;
    const [, throwing] = pickEndpoint(
      {
        pick: () => [
          null,
          {
            endpoint: "https://a",
            done() {
              exploded += 1;
              throw new Error("done failed");
            },
          },
        ],
      },
      base,
    );
    expect(() => throwing?.done({ attempted: false })).not.toThrow();
    expect(throwing?.finished()).toBe(true);
    throwing?.done({ attempted: false });
    expect(exploded).toBe(1);
  });
});

test.each(["NET_UNREACHABLE", "NET_UNAVAILABLE"] as const)(
  "pick_first advances on neutral %s without a status",
  (code) => {
    const b = pickFirstBalancer({ outlierDetection: false });
    const candidates = info(["a", "b"]);
    b.pick(candidates)[1]?.done?.({ attempted: true, code });
    expect(b.pick(candidates)[1]?.endpoint).toBe("b");
  },
);
test("pick_first ignores a raw 503 without a neutral outcome", () => {
  const b = pickFirstBalancer({ outlierDetection: false });
  const candidates = info(["a", "b"]);
  b.pick(candidates)[1]?.done?.({ attempted: true, status: 503 });
  expect(b.pick(candidates)[1]?.endpoint).toBe("a");
});
