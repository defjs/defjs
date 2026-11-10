import { expect, inject, test } from "vitest";
import {
  createClient,
  defineEventStream,
  defineRequest,
  struct,
  withBalancer,
  withEndpoint,
  withRetry,
} from "../src";
import type { Balancer, DoneInfo, PickFaultCode } from "../src";
import { fixture } from "./fixture/client-auto";

function recordingBalancer() {
  const ends: DoneInfo[] = [];
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick({ endpoints }) {
      return [
        null,
        {
          endpoint: endpoints[0] ?? "",
          end: (info) => {
            ends.push(info);
          },
          done: (info) => {
            dones.push(info);
          },
        },
      ];
    },
  };
  return { balancer, ends, dones };
}

const outcomes: ReadonlyArray<readonly [number, PickFaultCode | undefined]> = [
  [502, "NET_UNAVAILABLE"],
  [503, "NET_UNAVAILABLE"],
  [504, "NET_UNAVAILABLE"],
  [500, "NET_SERVER_ERROR"],
  [501, "NET_SERVER_ERROR"],
  [505, "NET_SERVER_ERROR"],
  [404, undefined],
  [429, undefined],
  [200, undefined],
];
test.each(outcomes)(
  "real HTTP %s reports neutral %s to end and done",
  async (status, code) => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    const h = recordingBalancer();
    const url = await f.endpoint("neutral", "respond", {
      status,
      body: '"ok"',
    });
    const client = createClient(withEndpoint(url), withBalancer(h.balancer));
    await defineRequest({ method: "GET", path: "/" })(client);
    const expected = { attempted: true, status, ...(code ? { code } : {}) };
    expect(h.ends).toEqual([expected]);
    expect(h.dones).toEqual([expected]);
  },
);

test("real HTTP truncated 200 body keeps NET_BODY_INCOMPLETE and its raw status", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const h = recordingBalancer();
  await f.endpoint("anchor", "hang", {});
  const base = f.rawUrl(inject("rawServerOrigin"), "truncated", "200");
  const client = createClient(withEndpoint(base), withBalancer(h.balancer));
  const [fault] = await defineRequest({
    method: "GET",
    path: "/",
    output: struct.object({ partial: struct.string() }),
    error: struct.object({ partial: struct.string() }),
  })(client);
  expect(fault?.code).toBe("NET_BODY_INCOMPLETE");
  expect(h.ends).toEqual([{ attempted: true, status: 200 }]);
  expect(h.dones).toEqual([
    { attempted: true, code: "NET_BODY_INCOMPLETE", status: 200 },
  ]);
});

test("real SSE 503 handshake reports NET_UNAVAILABLE to end and done", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const h = recordingBalancer();
  const url = await f.endpoint("neutral", "respond", {
    status: 503,
    body: "unavailable",
  });
  const client = createClient(
    withEndpoint(url),
    withBalancer(h.balancer),
    withRetry({ maxRetries: 0 }),
  );
  const [fault] = await defineEventStream({ path: "/", events: {} })(client);
  expect(fault?.code).toBe("HTTP_STATUS");
  const expected = { attempted: true, code: "NET_UNAVAILABLE", status: 503 };
  expect(h.ends).toEqual([expected]);
  expect(h.dones).toEqual([expected]);
});

test.each([
  ["application/json", "{broken", "RES_DECODE_FAILED"],
  ["text/html", "<html>unavailable</html>", "RES_MEDIA_TYPE_INVALID"],
] as const)(
  "real HTTP gateway %s body failure %s preserves neutral feedback",
  async (contentType, body, code) => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    const h = recordingBalancer();
    const url = await f.endpoint("neutral", "respond", {
      status: 503,
      contentType,
      body,
    });
    const client = createClient(withEndpoint(url), withBalancer(h.balancer));
    const [fault] = await defineRequest({
      method: "GET",
      path: "/",
      error: struct.object({ message: struct.string() }),
    })(client);
    expect(fault?.code).toBe(code);
    const expected = {
      attempted: true,
      code: "NET_UNAVAILABLE",
      status: 503,
    };
    expect(h.ends).toEqual([expected]);
    expect(h.dones).toEqual([expected]);
  },
);
