import { expect, test } from "vitest";
import type { LiveConnection } from "../fixture/state.ts";
import type { LoggedRequest } from "../fixture/types.ts";
import { createHarness } from "./fixture-app-harness.ts";

function logged(endpoint: string, method = "GET", path = "/"): LoggedRequest {
  return { endpoint, method, path, headers: {} };
}

test("control routes reject a missing or wrong token (403); actions reject text/plain (415) and invalid bodies (400)", async () => {
  const harness = createHarness({ logWaitCapMs: 1 });
  harness.registry.create("id1");
  const routes = [
    ["POST", "/__fixture/id1/actions"],
    ["GET", "/__fixture/id1/log"],
    ["DELETE", "/__fixture/id1"],
  ] as const;
  for (const [method, path] of routes) {
    for (const token of [null, "nope"] as const) {
      const response = await harness.call(method, path, { token });
      expect(response.status).toBe(403);
    }
  }

  const plain = await harness.call("POST", "/__fixture/id1/actions", {
    body: "nope",
    headers: { "content-type": "text/plain" },
  });
  expect(plain.status).toBe(415);

  const exploded = await harness.call("POST", "/__fixture/id1/actions", {
    json: { target: "a", action: "explode" },
  });
  expect(exploded.status).toBe(400);

  const negative = await harness.call("POST", "/__fixture/id1/actions", {
    json: { target: "a", action: "end", request: -1 },
  });
  expect(negative.status).toBe(400);
});

test("actions: unknown id or target is 404; no live connection is 409", async () => {
  const harness = createHarness({ logWaitCapMs: 1 });
  const state = harness.registry.create("id1");

  expect(
    (
      await harness.call("POST", "/__fixture/nope/actions", {
        json: { target: "a", action: "end" },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "ghost", action: "end" },
      })
    ).status,
  ).toBe(404);

  state.endpoints.set("a", { name: "a", scenario: "hang", params: {} });
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "a", action: "end" },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "a", action: "end", request: 3 },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "raw:truncated", action: "end" },
      })
    ).status,
  ).toBe(409);
});

test("actions: apply finishes before the 204; false is 409; request selects the connection", async () => {
  const harness = createHarness({ logWaitCapMs: 1 });
  const state = harness.registry.create("id1");
  const order: string[] = [];
  state.endpoints.set("a", { name: "a", scenario: "hang", params: {} });
  state.track("a", {
    request: 0,
    apply() {
      order.push("applied");
      return Promise.resolve(true);
    },
    release() {
      return Promise.resolve();
    },
  });
  const applied = await harness.call("POST", "/__fixture/id1/actions", {
    json: { target: "a", action: "end", request: 0 },
  });
  order.push("responded");
  expect(applied.status).toBe(204);
  expect(order).toEqual(["applied", "responded"]);

  state.endpoints.set("b", { name: "b", scenario: "hang", params: {} });
  state.track("b", {
    request: 0,
    apply() {
      return Promise.resolve(false);
    },
    release() {
      return Promise.resolve();
    },
  });
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "b", action: "end" },
      })
    ).status,
  ).toBe(409);

  state.endpoints.set("c", { name: "c", scenario: "hang", params: {} });
  const hits: number[] = [];
  function tracked(request: number): LiveConnection {
    return {
      request,
      apply() {
        hits.push(request);
        return Promise.resolve(true);
      },
      release() {
        return Promise.resolve();
      },
    };
  }
  state.track("c", tracked(0));
  state.track("c", tracked(1));
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "c", action: "end", request: 0 },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await harness.call("POST", "/__fixture/id1/actions", {
        json: { target: "c", action: "end" },
      })
    ).status,
  ).toBe(204);
  expect(hits).toEqual([0, 1]);
});

test("log long-polls; wait beyond the cap is 408; bad wait is 400; unknown id is 404", async () => {
  const harness = createHarness({ logWaitCapMs: 1 });
  const state = harness.registry.create("id1");

  const timed = await harness.call("GET", "/__fixture/id1/log?wait=5");
  expect(timed.status).toBe(408);
  const partial: unknown = await timed.json();
  expect(partial).toEqual({ requests: [] });

  expect((await harness.call("GET", "/__fixture/id1/log?wait=-1")).status).toBe(
    400,
  );
  expect((await harness.call("GET", "/__fixture/id1/log?wait=x")).status).toBe(
    400,
  );
  expect((await harness.call("GET", "/__fixture/nope/log")).status).toBe(404);

  const first = logged("primary");
  const second = logged("primary", "POST", "/events");
  state.record(first);
  const pending = harness.call("GET", "/__fixture/id1/log?wait=2");
  state.record(second);
  const ready = await pending;
  expect(ready.status).toBe(200);
  const body: unknown = await ready.json();
  expect(body).toEqual({ requests: [first, second] });
});

test("DELETE releases the state; an unknown id is also 204", async () => {
  const harness = createHarness({ logWaitCapMs: 1 });
  const state = harness.registry.create("id1");
  const released: string[] = [];
  state.track("a", {
    request: 0,
    apply() {
      return Promise.resolve(true);
    },
    release() {
      released.push("release");
      return Promise.resolve();
    },
  });

  expect((await harness.call("DELETE", "/__fixture/id1")).status).toBe(204);
  expect(harness.registry.get("id1")).toBeUndefined();
  expect(released).toEqual(["release"]);
  expect((await harness.call("DELETE", "/__fixture/never")).status).toBe(204);
});
