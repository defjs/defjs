import { afterEach, describe, expect, inject, test, vi } from "vitest";
import type { Balancer, DoneInfo, PickInfo } from "../balancer";
import { ERR_NO_CANDIDATE, pickFirstBalancer } from "../balancer";
import {
  createClient,
  withEndpoint,
  withBalancer,
  withHTTPHandle,
  withInterceptors,
} from "../client";
import { ERR_FETCH_UNSUPPORTED } from "../client/config";
import { ERR_TIMEOUT } from "../error";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "./http_response";
import { struct } from "../struct";
import { defineRequest } from "./index";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "./transport/fetch_init";
import type { FixtureClient } from "../../test/fixture/client";
import { fixture } from "../../test/fixture/client-auto";
import type { ScenarioName, ScenarioParams } from "../../test/fixture/types";

interface Probe {
  url: string;
  hits(): Promise<string[]>;
  client: FixtureClient;
}

async function serve<S extends ScenarioName>(
  scenario: S,
  params: ScenarioParams[S],
): Promise<Probe> {
  const client = fixture(inject("testServerHost"), inject("fixtureToken"));
  const url = await client.endpoint("probe", scenario, params);
  return {
    url,
    client,
    async hits() {
      const logged = await client.log();
      return logged.requests.map((request) => request.path);
    },
  };
}

function refused(name: "a" | "b"): string {
  return `${inject("refusedOrigin")}/${name}`;
}

function watch(inner: Balancer) {
  const picks: PickInfo[] = [];
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick(info) {
      picks.push(info);
      const outcome = inner.pick(info);
      if (outcome[0] !== null) {
        return outcome;
      }
      const selected = outcome[1];
      return [
        null,
        {
          endpoint: selected.endpoint,
          done(report) {
            dones.push(report);
            selected.done?.(report);
          },
        },
      ];
    },
  };
  return { balancer, dones, picks };
}

const get = defineRequest({ method: "GET", path: "/" });

describe("HTTP endpoint balancer", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("advances pickFirstBalancer on the next call after a refused connection", async () => {
    const live = await serve("respond", { status: 204 });
    const dead = refused("a");
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(dead, live.url),
      withBalancer(watched.balancer),
    );

    const [first] = await get(client);
    const [second] = await get(client);

    expect(first?.code).toBe("NET_UNREACHABLE");
    expect(second).toBeNull();
    expect(await live.hits()).toEqual(["/"]);
    expect(watched.dones[0]).toEqual({
      attempted: true,
      code: "NET_UNREACHABLE",
    });
    expect(watched.picks.map((info) => info.endpoints[0])).toEqual([
      dead,
      dead,
    ]);
    expect(watched.picks[1]?.endpoints[1]).toBe(live.url);
  });

  test("does not advance pickFirstBalancer after an HTTP 500", async () => {
    const primary = await serve("respond", { status: 500, body: "down" });
    const backup = await serve("respond", { status: 204 });
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(primary.url, backup.url),
      withBalancer(watched.balancer),
    );

    const [first] = await get(client);
    const [second] = await get(client);

    expect(first?.code).toBe("HTTP_STATUS");
    expect(second?.code).toBe("HTTP_STATUS");
    expect(await primary.hits()).toEqual(["/", "/"]);
    expect(await backup.hits()).toEqual([]);
    expect(watched.dones).toEqual([
      { attempted: true, code: "NET_SERVER_ERROR", status: 500 },
      { attempted: true, code: "NET_SERVER_ERROR", status: 500 },
    ]);
  });

  test("does not advance pickFirstBalancer after NET_TIMEOUT", async () => {
    const hang = await serve("hang", {});
    const backup = await serve("respond", { status: 204 });
    let trap = false;
    const seen: string[] = [];
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(hang.url, backup.url),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          if (!trap) {
            return next(request);
          }
          seen.push(request.baseEndpoint ?? "");
          return makeResponse({ status: 204 });
        }),
      ),
    );

    const [timedOut] = await get(client({ signal: AbortSignal.timeout(500) }));
    trap = true;
    const [nextCall] = await get(client);

    expect(timedOut?.code).toBe("NET_TIMEOUT");
    expect(nextCall).toBeNull();
    expect(seen).toEqual([hang.url]);
    expect(await backup.hits()).toEqual([]);
    expect(watched.dones[0]).toEqual({
      attempted: true,
      code: "NET_TIMEOUT",
    });
  }, 10_000);

  test("advances pickFirstBalancer only one endpoint when overlapping calls fail", async () => {
    const live = await serve("respond", { status: 204 });
    const firstDead = refused("a");
    const secondDead = refused("b");
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(firstDead, secondDead, live.url),
      withBalancer(watched.balancer),
    );

    const [left, right] = await Promise.all([get(client), get(client)]);
    const [third] = await get(client);
    const [fourth] = await get(client);

    expect(left[0]?.code).toBe("NET_UNREACHABLE");
    expect(right[0]?.code).toBe("NET_UNREACHABLE");
    expect(third?.code).toBe("NET_UNREACHABLE");
    expect(fourth).toBeNull();
    expect(await live.hits()).toEqual(["/"]);
    expect(watched.dones.slice(0, 2)).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
  });

  test("returns REQ_BUILD_FAILED with the thrown pick cause and does not throw", async () => {
    const reason = new Error("pick");
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer({
        pick() {
          throw reason;
        },
      }),
    );

    await expect(get(client)).resolves.toMatchObject([
      { cause: reason, code: "REQ_BUILD_FAILED" },
      undefined,
      undefined,
    ]);
  });

  test("returns REQ_BUILD_FAILED with ERR_NO_CANDIDATE when no endpoint is configured", async () => {
    const watched = watch(pickFirstBalancer());
    const client = createClient(withBalancer(watched.balancer));

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(ERR_NO_CANDIDATE);
    expect(watched.dones).toEqual([]);
  });

  test("reports attempted false when makeResponse copies fields without calling next", async () => {
    const live = await serve("respond", { status: 503 });
    const watched = watch(pickFirstBalancer());
    const copied = {
      body: { down: true },
      headers: new Headers({ "content-type": "application/json" }),
      status: 503,
      statusText: "Service Unavailable",
      url: `${live.url}/down`,
    };
    const client = createClient(
      withEndpoint(live.url),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(() => Promise.resolve(makeResponse(copied))),
      ),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("HTTP_STATUS");
    expect(await live.hits()).toEqual([]);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("reports only the status when declared decoding fails and does not advance pick_first", async () => {
    const primary = await serve("respond", {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "nope" }),
    });
    const backup = await serve("respond", { status: 204 });
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/",
    });
    const client = createClient(
      withEndpoint(primary.url, backup.url),
      withBalancer(watched.balancer),
    );

    const [first] = await read(client);
    const [second] = await read(client);

    expect(first?.code).toBe("RES_STRUCT_MISMATCH");
    expect(second?.code).toBe("RES_STRUCT_MISMATCH");
    expect(await primary.hits()).toEqual(["/", "/"]);
    expect(await backup.hits()).toEqual([]);
    expect(watched.dones).toEqual([
      { attempted: true, status: 200 },
      { attempted: true, status: 200 },
    ]);
  });

  test("reports only the status when the response media type is wrong", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("nope", {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        ),
      ),
    );

    const [fault] = await read(client);

    expect(fault?.code).toBe("RES_MEDIA_TYPE_INVALID");
    expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
  });

  test("reports only the status when response JSON fails to parse", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("not-json", {
            headers: { "content-type": "application/json" },
            status: 201,
          }),
        ),
      ),
    );

    const [fault] = await read(client);

    expect(fault?.code).toBe("RES_DECODE_FAILED");
    expect(watched.dones).toEqual([{ attempted: true, status: 201 }]);
  });

  test("calls done once when the builder throws", async () => {
    const reason = new Error("build");
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      builder: () => {
        throw reason;
      },
      input: struct.object({}),
      method: "GET",
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
    );

    const [fault] = await read(client, {});

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(reason);
    expect(watched.picks).toHaveLength(1);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("calls done once when the caller aborts before next", async () => {
    const watched = watch(pickFirstBalancer());
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(
          () =>
            new Promise(() => {
              markReady();
            }),
        ),
      ),
    );

    const pending = get(client({ signal: controller.signal }));
    await ready;
    controller.abort();

    const [fault] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(watched.picks).toHaveLength(1);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("does not pick when the caller already aborted", async () => {
    const watched = watch(pickFirstBalancer());
    const controller = new AbortController();
    controller.abort();
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
    );

    const [fault] = await get(client({ signal: controller.signal }));

    expect(fault?.code).toBe("NET_ABORTED");
    expect(watched.picks).toEqual([]);
    expect(watched.dones).toEqual([]);
  });

  test("reports attempted false when next is rejected before fetch", async () => {
    const live = await serve("respond", { status: 204 });
    const watched = watch(pickFirstBalancer());
    const controller = new AbortController();
    const client = createClient(
      withEndpoint(live.url),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          controller.abort();
          return next(request);
        }),
      ),
    );

    const [fault] = await get(client({ signal: controller.signal }));

    expect(fault?.code).toBe("NET_ABORTED");
    expect(await live.hits()).toEqual([]);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("reports attempted false when the deadline is already due before fetch", async () => {
    const watched = watch(pickFirstBalancer());
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          controller.abort(ERR_TIMEOUT);
          return next(request);
        }),
      ),
    );

    const [fault] = await get(client({ signal: controller.signal }));

    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("keeps the endpoint outcome when a timeout comes from interceptor work after the send settled", async () => {
    const live = await serve("respond", { status: 200, body: "ok" });
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(live.url, "https://backup.example"),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          await next(request);
          throw ERR_TIMEOUT;
        }),
      ),
    );

    const [fault] = await get(client);
    const [again] = await get(client);

    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(again?.code).toBe("NET_TIMEOUT");
    expect(await live.hits()).toEqual(["/", "/"]);
    expect(watched.dones).toEqual([
      { attempted: true, status: 200 },
      { attempted: true, status: 200 },
    ]);
  });

  test("calls done once when an interceptor short-circuits", async () => {
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(makeResponse({ status: 204 })),
        ),
      ),
    );

    const [fault] = await get(client);

    expect(fault).toBeNull();
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("does not attribute a rewritten endpoint's transport rejection to the selected endpoint", async () => {
    const cause = new Error("rewritten endpoint unavailable");
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint("https://primary.example"),
      withBalancer(watched.balancer),
      withHTTPHandle(() => Promise.reject(cause)),
      withInterceptors(
        createHttpInterceptor((request, next) =>
          next({ ...request, baseEndpoint: "https://rewritten.example" }),
        ),
      ),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(fault?.cause).toBe(cause);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("reports attempted false when an interceptor replaces baseEndpoint", async () => {
    const primary = await serve("respond", { status: 500 });
    const backup = await serve("respond", { status: 204 });
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(primary.url, backup.url),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor((request, next) =>
          next({ ...request, baseEndpoint: backup.url }),
        ),
      ),
    );

    const [fault] = await get(client);

    expect(fault).toBeNull();
    expect(await primary.hits()).toEqual([]);
    expect(await backup.hits()).toEqual(["/"]);
    expect(watched.picks[0]).toMatchObject({
      endpoints: [primary.url, backup.url],
    });
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("passes candidates and the definition operation without transport metadata to every pick", async () => {
    const live = await serve("respond", { status: 204 });
    const watched = watch(pickFirstBalancer());
    const named = defineRequest({
      method: "GET",
      operation: "loadOrder",
      path: "/orders",
    });
    const plain = defineRequest({ method: "GET", path: "/health" });
    const client = createClient(
      withEndpoint(live.url, "https://backup.example"),
      withBalancer(watched.balancer),
    );

    await named(client);
    await plain(client);
    for (const picked of watched.picks)
      expect(picked).not.toHaveProperty("transport");

    expect(watched.picks[0]).toMatchObject({
      endpoints: [live.url, "https://backup.example"],
      operation: "loadOrder",
    });
    expect(watched.picks[1]).toMatchObject({
      operation: undefined,
    });
  });

  test("reports NET_BODY_INCOMPLETE with the response status", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("cut"));
          },
        });
        return Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        );
      }),
    );

    const [fault] = await read(client);

    expect(fault?.code).toBe("NET_BODY_INCOMPLETE");
    expect(watched.dones).toEqual([
      {
        attempted: true,
        code: "NET_BODY_INCOMPLETE",
        status: 200,
      },
    ]);
  });

  test("reports only the status when a download observer fails after the response", async () => {
    const watched = watch(pickFirstBalancer());
    const read = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("hello", {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        ),
      ),
    );

    const [fault] = await read(
      client({
        onDownloadProgress() {
          throw new Error("watch");
        },
      }),
    );

    expect(fault?.code).toBe("EXT_OBSERVER_FAILED");
    expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
  });

  test("reports attempted false for fetch and streaming sentinels", async () => {
    const cases = [
      ERR_FETCH_UNSUPPORTED,
      ERR_STREAMING_REQUEST_UNSUPPORTED,
    ] as const;
    for (const sentinel of cases) {
      const watched = watch(pickFirstBalancer());
      const client = createClient(
        withEndpoint("https://example.com"),
        withBalancer(watched.balancer),
        withHTTPHandle(() => {
          throw sentinel;
        }),
      );

      const [fault] = await get(client);

      expect(fault?.code).toBe("ENV_UNSUPPORTED");
      expect(fault?.cause).toBe(sentinel);
      expect(watched.dones).toEqual([{ attempted: false }]);
    }
  });

  test("keeps the last matching next when an earlier one settles later", async () => {
    // The order is held in the handle: two concurrent requests can reach a real server either way round.
    const held = Promise.withResolvers<Response>();
    let sends = 0;
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() => {
        sends += 1;
        return sends === 1
          ? held.promise
          : Promise.resolve(new Response("ok", { status: 200 }));
      }),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          const first = next(request);
          const second = await next(request);
          held.resolve(new Response(null, { status: 500 }));
          await first;
          return second;
        }),
      ),
    );

    const [fault] = await get(client);

    expect(fault).toBeNull();
    expect(watched.picks).toHaveLength(1);
    expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
  });

  test("reports attempted false when the selected endpoint URL cannot be resolved", async () => {
    const live = await serve("respond", { status: 204 });
    const watched = watch(pickFirstBalancer());
    const client = createClient(
      withEndpoint(live.url),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor((request, next) =>
          next({ ...request, endpoint: "http://[" }),
        ),
      ),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(await live.hits()).toEqual([]);
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("returns a build-failure tuple when the picked endpoint getter throws", async () => {
    const cause = new Error("endpoint getter");
    const client = createClient(
      withBalancer({
        pick: () => [
          null,
          {
            get endpoint(): string {
              throw cause;
            },
          },
        ],
      }),
    );

    const [fault] = await get(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(cause);
  });

  test("still returns the tuple when done throws", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer({
        pick: () => [
          null,
          {
            endpoint: "https://example.com",
            done() {
              throw new Error("done blew up");
            },
          },
        ],
      }),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      ),
    );

    const [fault] = await get(client);

    expect(fault).toBeNull();
    expect(report).toHaveBeenCalledOnce();
  });
});
