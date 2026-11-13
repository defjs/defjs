import { expect, test } from "vitest";
import type { FixtureState } from "../fixture/state.ts";
import type { Harness } from "./fixture-app-harness.ts";
import { createHarness } from "./fixture-app-harness.ts";

function put(
  harness: Harness,
  id: string,
  name: string,
  scenario: string,
  params: unknown,
): Promise<Response> {
  return harness.call(
    "PUT",
    `/__fixture/${id}/endpoints/${encodeURIComponent(name)}`,
    { json: { scenario, params } },
  );
}

function stateOf(harness: Harness, id: string): FixtureState {
  const state = harness.registry.get(id);
  if (state === undefined) throw new Error(`missing fixture ${id}`);
  return state;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function field(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  const value: unknown = Reflect.get(record, key);
  return value;
}

function isLogged(value: unknown): value is {
  endpoint: string;
  method: string;
  path: string;
  headers: object;
} {
  if (typeof value !== "object" || value === null) return false;
  const headers = field(value, "headers");
  return (
    typeof field(value, "endpoint") === "string" &&
    typeof field(value, "method") === "string" &&
    typeof field(value, "path") === "string" &&
    typeof headers === "object" &&
    headers !== null
  );
}

async function readLog(
  harness: Harness,
  id: string,
): Promise<readonly unknown[]> {
  const response = await harness.call("GET", `/__fixture/${id}/log`);
  expect(response.status).toBe(200);
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("malformed log response");
  }
  const requests: unknown = Reflect.get(payload, "requests");
  if (!isUnknownArray(requests)) throw new Error("malformed log response");
  return requests;
}

test("PUT returns the base URL; bad registrations, token and content-type are rejected", async () => {
  const harness = createHarness();
  const created = await put(harness, "id1", "primary", "respond", {
    status: 200,
    body: "hi",
  });
  expect(created.status).toBe(200);
  const payload: unknown = await created.json();
  expect(payload).toEqual({
    url: "http://127.0.0.1:4000/__fixture/id1/e/primary",
  });

  expect((await put(harness, "id1", "primary", "nope", {})).status).toBe(400);
  expect(
    (await put(harness, "id1", "primary", "respond", { status: "x" })).status,
  ).toBe(400);
  expect(
    (await put(harness, "id1", "a b", "respond", { status: 200 })).status,
  ).toBe(400);

  const missingToken = await harness.call(
    "PUT",
    "/__fixture/id1/endpoints/primary",
    {
      token: null,
      json: { scenario: "respond", params: { status: 200, body: "hi" } },
    },
  );
  expect(missingToken.status).toBe(403);

  const plain = await harness.call("PUT", "/__fixture/id1/endpoints/primary", {
    body: "nope",
    headers: { "content-type": "text/plain" },
  });
  expect(plain.status).toBe(415);
});

test("the whole base subtree answers and is logged; unknown id or name is 404 without a token", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "primary", "respond", {
        status: 200,
        body: "hi",
      })
    ).status,
  ).toBe(200);

  for (const path of [
    "/__fixture/id1/e/primary",
    "/__fixture/id1/e/primary/",
    "/__fixture/id1/e/primary/events",
    "/__fixture/id1/e/primary/a/b/c?x=1",
  ]) {
    const response = await harness.call("GET", path, { token: null });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hi");
  }

  const probed = await harness.call("POST", "/__fixture/id1/e/primary/events", {
    token: null,
    headers: { "x-probe": "1" },
  });
  expect(await probed.text()).toBe("hi");

  const logged = await readLog(harness, "id1");
  const probe = logged.find(
    (request) =>
      isLogged(request) &&
      request.method === "POST" &&
      request.path === "/events",
  );
  if (!isLogged(probe)) throw new Error("missing probe log");
  expect(probe.endpoint).toBe("primary");
  const headers = probe.headers;
  expect(field(headers, "x-probe")).toBe("1");
  expect(
    logged.some(
      (request) =>
        isLogged(request) && request.method === "GET" && request.path === "/",
    ),
  ).toBe(true);

  expect(
    (await harness.call("GET", "/__fixture/missing/e/primary", { token: null }))
      .status,
  ).toBe(404);
  expect(
    (await harness.call("GET", "/__fixture/id1/e/missing", { token: null }))
      .status,
  ).toBe(404);
});

test("respond honors status, headers and contentType; re-registering replaces it", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "tea", "respond", {
        status: 418,
        headers: { "x-a": "1" },
        contentType: "application/json",
        body: '{"ok":true}',
      })
    ).status,
  ).toBe(200);

  const first = await harness.call("GET", "/__fixture/id1/e/tea", {
    token: null,
  });
  expect(first.status).toBe(418);
  expect(first.headers.get("x-a")).toBe("1");
  expect(first.headers.get("content-type")).toBe("application/json");
  expect(await first.text()).toBe('{"ok":true}');

  const before = stateOf(harness, "id1").requests.length;
  expect(
    (
      await put(harness, "id1", "tea", "respond", {
        status: 200,
        body: "next",
      })
    ).status,
  ).toBe(200);
  const second = await harness.call("GET", "/__fixture/id1/e/tea", {
    token: null,
  });
  expect(second.status).toBe(200);
  expect(await second.text()).toBe("next");
  expect(stateOf(harness, "id1").requests.length).toBe(before + 1);
  expect(stateOf(harness, "id1").requests[0]?.path).toBe("/");
});

test("gzip serves compressed bytes with the compressed content-length", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "packed", "gzip", {
        body: "hello hello hello",
      })
    ).status,
  ).toBe(200);

  const response = await harness.call("GET", "/__fixture/id1/e/packed", {
    token: null,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-encoding")).toBe("gzip");
  const compressed = new Uint8Array(await response.arrayBuffer());
  expect(response.headers.get("content-length")).toBe(
    String(compressed.byteLength),
  );
  const plain = await new Response(
    new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).text();
  expect(plain).toBe("hello hello hello");
});

test("hang stays pending, is tracked, and end answers 204", async () => {
  const harness = createHarness();
  expect((await put(harness, "id1", "slow", "hang", {})).status).toBe(200);
  const state = stateOf(harness, "id1");
  const pending = harness.call("GET", "/__fixture/id1/e/slow", { token: null });
  await state.whenLogged(1);
  const connection = state.live("slow");
  if (connection === undefined) throw new Error("missing hang connection");
  expect(await connection.apply("end")).toBe(true);
  expect((await pending).status).toBe(204);

  const dropped = harness.call("GET", "/__fixture/id1/e/slow", { token: null });
  await state.whenLogged(2);
  const next = state.live("slow");
  if (next === undefined) throw new Error("missing hang connection");
  expect(await next.apply("drop")).toBe(false);
  await harness.registry.delete("id1");
  expect((await dropped).status).toBe(204);
});

test("hang is untracked on client abort and released by DELETE", async () => {
  const harness = createHarness();
  expect((await put(harness, "id1", "slow", "hang", {})).status).toBe(200);
  const state = stateOf(harness, "id1");
  const controller = new AbortController();
  const aborted = harness.call("GET", "/__fixture/id1/e/slow", {
    token: null,
    signal: controller.signal,
  });
  await state.whenLogged(1);
  expect(state.live("slow")).toBeDefined();
  controller.abort();
  await aborted.then(
    () => undefined,
    () => undefined,
  );
  expect(state.live("slow")).toBeUndefined();

  const held = harness.call("GET", "/__fixture/id1/e/slow", { token: null });
  await state.whenLogged(2);
  expect(state.live("slow")).toBeDefined();
  await harness.registry.delete("id1");
  expect((await held).status).toBe(204);
});

test.each([204, 205, 304])(
  "status %s sends an empty body; a body or gzip is rejected",
  async (status) => {
    const harness = createHarness();
    expect(
      (await put(harness, "id1", "empty", "respond", { status })).status,
    ).toBe(200);
    const response = await harness.call("GET", "/__fixture/id1/e/empty", {
      token: null,
    });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");

    expect(
      (
        await put(harness, "id1", "empty", "respond", {
          status,
          body: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (await put(harness, "id1", "packed", "gzip", { body: "x", status }))
        .status,
    ).toBe(400);
  },
);

test("logged paths strip the exact endpoint base, including a nested or prefix-colliding remainder", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "primary", "respond", {
        status: 200,
        body: "hi",
      })
    ).status,
  ).toBe(200);
  expect(
    (await put(harness, "id1", "a", "respond", { status: 200, body: "a" }))
      .status,
  ).toBe(200);

  const cases = [
    {
      endpoint: "primary",
      path: "/__fixture/id1/e/primary/e/primary",
      logged: "/e/primary",
    },
    {
      endpoint: "a",
      path: "/__fixture/id1/e/a/e/ab/x",
      logged: "/e/ab/x",
    },
    {
      endpoint: "primary",
      path: "/__fixture/id1/e/primary/",
      logged: "/",
    },
    {
      endpoint: "primary",
      path: "/__fixture/id1/e/primary/a/b/c?x=1",
      logged: "/a/b/c",
    },
  ];

  for (const item of cases) {
    const response = await harness.call("GET", item.path, { token: null });
    expect(response.status).toBe(200);
  }

  const requests = stateOf(harness, "id1").requests;
  expect(requests.map((request) => request.endpoint)).toEqual(
    cases.map((item) => item.endpoint),
  );
  expect(requests.map((request) => request.path)).toEqual(
    cases.map((item) => item.logged),
  );
});

test("a percent-encoded endpoint name is logged from the raw path remainder", async () => {
  const harness = createHarness();
  expect(
    (await put(harness, "id1", "a", "respond", { status: 200, body: "a" }))
      .status,
  ).toBe(200);
  const response = await harness.call("GET", "/__fixture/id1/e/%61/x", {
    token: null,
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("a");
  const requests = stateOf(harness, "id1").requests;
  expect(requests.map((request) => request.endpoint)).toEqual(["a"]);
  expect(requests.map((request) => request.path)).toEqual(["/x"]);
});
