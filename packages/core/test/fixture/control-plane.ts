import type { Context, Hono, MiddlewareHandler } from "hono";
import type { FixtureRegistry, FixtureState } from "./state.ts";
import type { ActionBody, ActionKind } from "./types.ts";

export interface ControlPlaneDeps {
  registry: FixtureRegistry;
  token: string;
  logWaitCapMs: number;
}

export function controlCors(): MiddlewareHandler {
  return async (c, next) => {
    const origin = loopbackOrigin(c.req.header("origin"));
    if (origin !== undefined) {
      c.header("access-control-allow-origin", origin);
      c.header(
        "access-control-allow-methods",
        "GET, PUT, POST, DELETE, OPTIONS",
      );
      c.header("access-control-allow-headers", "content-type, x-fixture-token");
    }
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  };
}

export function controlGuard(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("x-fixture-token") !== token) {
      return c.body(null, 403);
    }
    if (
      (c.req.method === "POST" || c.req.method === "PUT") &&
      !isJsonContentType(c.req.header("content-type"))
    ) {
      return c.body(null, 415);
    }
    await next();
  };
}

export function registerControlPlane(app: Hono, deps: ControlPlaneDeps): void {
  app.use("/__fixture/:id/actions", controlCors(), controlGuard(deps.token));
  app.use("/__fixture/:id/log", controlCors(), controlGuard(deps.token));
  app.use("/__fixture/:id", controlCors(), controlGuard(deps.token));
  app.post("/__fixture/:id/actions", (c) => performAction(c, deps));
  app.get("/__fixture/:id/log", (c) => readLog(c, deps));
  app.delete("/__fixture/:id", async (c) => {
    await deps.registry.delete(c.req.param("id"));
    return c.body(null, 204);
  });
}

function loopbackOrigin(origin: string | undefined): string | undefined {
  if (origin === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    return origin;
  }
  return undefined;
}

function isJsonContentType(header: string | undefined): boolean {
  const media = header?.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: { [key: string]: unknown }, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  const value: unknown = Reflect.get(record, key);
  return value;
}

function isActionKind(value: unknown): value is ActionKind {
  switch (value) {
    case "end":
    case "drop":
    case "terminate":
      return true;
    default:
      return false;
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseActionBody(body: unknown): ActionBody | undefined {
  if (!isRecord(body)) return undefined;
  const target = own(body, "target");
  const action = own(body, "action");
  if (typeof target !== "string" || !isActionKind(action)) return undefined;
  if (!Object.hasOwn(body, "request")) return { target, action };
  const request = own(body, "request");
  if (!isNonNegativeInteger(request)) return undefined;
  return { target, action, request };
}

function isRawTarget(target: string): boolean {
  if (!target.startsWith("raw:")) return false;
  switch (target.slice("raw:".length)) {
    case "truncated":
    case "utf8-last-event-id":
    case "partial-frame-resume":
    case "reset-before-headers":
      return true;
    default:
      return false;
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    const body: unknown = await c.req.json();
    return body;
  } catch {
    return undefined;
  }
}

async function performAction(
  c: Context,
  deps: ControlPlaneDeps,
): Promise<Response> {
  const parsed = parseActionBody(await readJson(c));
  if (parsed === undefined) return c.body(null, 400);
  const id = c.req.param("id");
  if (id === undefined) return c.body(null, 404);
  const state = deps.registry.get(id);
  if (state === undefined) return c.body(null, 404);
  if (!state.endpoints.has(parsed.target) && !isRawTarget(parsed.target)) {
    return c.body(null, 404);
  }
  const connection = state.live(parsed.target, parsed.request);
  if (connection === undefined) return c.body(null, 409);
  const applied = await connection.apply(parsed.action);
  if (!applied) return c.body(null, 409);
  return c.body(null, 204);
}

async function readLog(c: Context, deps: ControlPlaneDeps): Promise<Response> {
  const wait = parseWait(c.req.query("wait"));
  if (wait === "invalid") return c.body(null, 400);
  const id = c.req.param("id");
  if (id === undefined) return c.body(null, 404);
  const state = deps.registry.get(id);
  if (state === undefined) return c.body(null, 404);
  if (wait !== undefined) {
    const outcome = await waitForCount(
      state,
      wait,
      deps.logWaitCapMs,
      c.req.raw.signal,
    );
    if (outcome === "aborted") return c.body(null, 204);
    if (outcome === "cap") return c.json({ requests: state.requests }, 408);
  }
  return c.json({ requests: state.requests });
}

function parseWait(raw: string | undefined): number | "invalid" | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) return "invalid";
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return "invalid";
  return value;
}

function waitForCount(
  state: FixtureState,
  count: number,
  capMs: number,
  signal: AbortSignal,
): Promise<"ready" | "cap" | "aborted"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cap = new Promise<"cap">((resolve) => {
    timer = setTimeout(() => resolve("cap"), capMs);
    timer.unref?.();
  });
  const aborted = new Promise<"aborted">((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    onAbort = () => resolve("aborted");
    signal.addEventListener("abort", onAbort);
  });
  return Promise.race([
    state.whenLogged(count).then(() => "ready" as const),
    cap,
    aborted,
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  });
}
