import { defineWebSocketHelper } from "hono/ws";
import { expect, test } from "vitest";
import { createFixtureApp } from "../fixture/app.ts";
import { createFixtureRegistry, type FixtureState } from "../fixture/state.ts";
import type { Harness } from "../regression/fixture-app-harness.ts";
import { createHarness } from "../regression/fixture-app-harness.ts";

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

export function registerFixtureCorsSuite(): void {
  test("data plane reflects any Origin and does not log OPTIONS", async () => {
    const harness = createHarness();
    expect(
      (
        await put(harness, "id1", "primary", "respond", {
          status: 200,
          body: "hi",
        })
      ).status,
    ).toBe(200);
    const state = stateOf(harness, "id1");
    const before = state.requests.length;
    const options = await harness.call("OPTIONS", "/__fixture/id1/e/primary", {
      token: null,
      headers: { origin: "http://app.example" },
    });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe(
      "http://app.example",
    );
    expect(state.requests.length).toBe(before);

    const response = await harness.call("GET", "/__fixture/id1/e/primary", {
      token: null,
      headers: { origin: "http://app.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://app.example",
    );
  });

  test("data plane preflight echoes requested headers and exposes the response headers", async () => {
    const harness = createHarness();
    expect(
      (
        await put(harness, "id1", "primary", "respond", {
          status: 200,
          headers: { "x-a": "1" },
          body: "hi",
        })
      ).status,
    ).toBe(200);
    const state = stateOf(harness, "id1");
    const before = state.requests.length;
    const options = await harness.call("OPTIONS", "/__fixture/id1/e/primary", {
      token: null,
      headers: {
        origin: "http://app.example",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "last-event-id, x-probe",
      },
    });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe(
      "http://app.example",
    );
    expect(options.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(options.headers.get("access-control-allow-methods")).toBe(
      "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    expect(options.headers.get("access-control-allow-headers")).toBe(
      "last-event-id, x-probe",
    );
    expect(options.headers.get("access-control-max-age")).toBe("86400");
    expect(state.requests.length).toBe(before);

    const response = await harness.call("GET", "/__fixture/id1/e/primary", {
      token: null,
      headers: { origin: "http://app.example" },
    });
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(
      response.headers.get("access-control-expose-headers")?.split(","),
    ).toContain("x-a");

    expect((await put(harness, "id1", "slow", "hang", {})).status).toBe(200);
    const pending = harness.call("GET", "/__fixture/id1/e/slow", {
      token: null,
      headers: { origin: "http://app.example" },
    });
    await state.whenLogged(before + 2);
    const connection = state.live("slow");
    if (connection === undefined) throw new Error("missing hang connection");
    expect(await connection.apply("end")).toBe(true);
    const hung = await pending;
    expect(hung.status).toBe(204);
    expect(hung.headers.get("access-control-allow-origin")).toBe(
      "http://app.example",
    );
    expect(hung.headers.get("access-control-allow-credentials")).toBe("true");
    expect(hung.headers.get("access-control-expose-headers")).toBeNull();
  });

  test("a script response reflects a forged origin", async () => {
    const harness = createHarness();
    expect(
      (
        await put(harness, "id1", "s", "script", {
          plan: [
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
              chunks: ["data: 1\n\n", "data: 2\n\n"],
              then: "end",
            },
          ],
        })
      ).status,
    ).toBe(200);
    const response = await harness.call("GET", "/__fixture/id1/e/s", {
      token: null,
      headers: { origin: "http://app.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://app.example",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  test.each([204, 205, 304])(
    "null-body status %s reflects credentials for a forged origin",
    async (status) => {
      const harness = createHarness();
      expect(
        (
          await put(harness, "id1", "later", "script", {
            plan: [
              {
                status,
                headers: { "x-step": "1" },
                chunks: [],
                then: "hold",
              },
            ],
          })
        ).status,
      ).toBe(200);
      const state = stateOf(harness, "id1");
      const pending = harness.call("GET", "/__fixture/id1/e/later", {
        token: null,
        headers: { origin: "http://app.example" },
      });
      await state.whenLogged(1);
      const connection = state.live("later");
      if (connection === undefined)
        throw new Error("missing script connection");
      expect(await connection.apply("end")).toBe(true);
      const held = await pending;
      expect(held.headers.get("access-control-allow-credentials")).toBe("true");
    },
  );

  // Origin is a forbidden request header.
  test("CORS reflects loopback origins only and never answers *", async () => {
    const harness = createHarness({ logWaitCapMs: 1 });
    harness.registry.create("id1");

    const local = await harness.call("OPTIONS", "/__fixture/id1/actions", {
      token: null,
      headers: { origin: "http://localhost:5173" },
    });
    expect(local.status).toBe(204);
    expect(local.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(local.headers.get("access-control-allow-headers")).toContain(
      "x-fixture-token",
    );
    expect(local.headers.get("access-control-allow-methods")).toContain(
      "DELETE",
    );
    expect(local.headers.get("access-control-allow-origin")).not.toBe("*");

    const loopback = await harness.call("OPTIONS", "/__fixture/id1/actions", {
      token: null,
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(loopback.status).toBe(204);
    expect(loopback.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:5173",
    );
    expect(loopback.headers.get("access-control-allow-origin")).not.toBe("*");

    const evil = await harness.call("OPTIONS", "/__fixture/id1/actions", {
      token: null,
      headers: { origin: "http://evil.example" },
    });
    expect(evil.status).toBe(204);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect(evil.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  test("answers a cross-origin preflight with the reflected origin", async () => {
    const app = createFixtureApp({
      upgradeWebSocket: defineWebSocketHelper(() => undefined),
      rawOrigin: () => "http://127.0.0.1:9",
      registry: createFixtureRegistry(),
      token: "token",
    });
    const response = await app.request("/json", {
      method: "OPTIONS",
      headers: {
        origin: "http://example.test",
        "access-control-request-method": "GET",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://example.test",
    );
  });

  // Upgrade, Connection, and Sec-WebSocket-* are forbidden request headers.
  test("a WebSocket upgrade to a respond endpoint answers 400", async () => {
    const harness = createHarness();
    expect(
      (
        await put(harness, "id1", "primary", "respond", {
          status: 200,
          body: "hi",
        })
      ).status,
    ).toBe(200);
    const response = await harness.call("GET", "/__fixture/id1/e/primary", {
      token: null,
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    expect(response.status).toBe(400);
  });
}
