import { Hono } from "hono";
import { defineWebSocketHelper } from "hono/ws";
import { registerControlPlane } from "../fixture/control-plane.ts";
import { registerDataPlane } from "../fixture/data-plane.ts";
import {
  createFixtureRegistry,
  type FixtureRegistry,
} from "../fixture/state.ts";

const upgradeWebSocket = defineWebSocketHelper(() => undefined);

export interface Harness {
  app: Hono;
  registry: FixtureRegistry;
  token: "test-token";
  call(
    method: string,
    path: string,
    init?: {
      token?: string | null;
      json?: unknown;
      body?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<Response>;
}

export function createHarness(options?: { logWaitCapMs?: number }): Harness {
  const registry = createFixtureRegistry();
  const token = "test-token";
  const app = new Hono();
  registerControlPlane(app, {
    registry,
    token,
    logWaitCapMs: options?.logWaitCapMs ?? 10_000,
  });
  registerDataPlane(app, { registry, token, upgradeWebSocket });
  return {
    app,
    registry,
    token,
    call: (method, path, init) => {
      const headers = new Headers(init?.headers);
      if (init?.token !== null) {
        headers.set("x-fixture-token", init?.token ?? token);
      }
      let body = init?.body;
      if (init?.json !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(init.json);
      }
      const url = new URL(path, "http://127.0.0.1:4000");
      const request: RequestInit = { method, headers, signal: init?.signal };
      if (body !== undefined) request.body = body;
      return Promise.resolve(app.request(url, request));
    },
  };
}
