import type { Context, Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { yieldMacrotask } from "../macrotask.ts";
import { controlCors, controlGuard } from "./control-plane.ts";
import { isRecord, isStringRecord, isUnknownArray, own } from "./records.ts";
import type { FixtureRegistry, FixtureState, LiveConnection } from "./state.ts";
import type {
  ActionKind,
  EndpointRegistration,
  FixtureHeaders,
  ScenarioParams,
  ScriptStep,
  StepThen,
} from "./types.ts";

export interface DataPlaneDeps {
  registry: FixtureRegistry;
  token: string;
  upgradeWebSocket: UpgradeWebSocket;
}

export function parseEndpointRegistration(
  name: string,
  body: unknown,
): EndpointRegistration | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return undefined;
  if (!isRecord(body)) return undefined;
  const scenario = own(body, "scenario");
  const params = own(body, "params");
  switch (scenario) {
    case "respond": {
      const parsed = parseRespond(params);
      if (parsed === undefined) return undefined;
      return { name, scenario, params: parsed };
    }
    case "hang": {
      const parsed = parseHang(params);
      if (parsed === undefined) return undefined;
      return { name, scenario, params: parsed };
    }
    case "gzip": {
      const parsed = parseGzip(params);
      if (parsed === undefined) return undefined;
      return { name, scenario, params: parsed };
    }
    case "script": {
      const parsed = parseScript(params);
      if (parsed === undefined) return undefined;
      return { name, scenario, params: parsed };
    }
    case "ws": {
      const parsed = parseWs(params);
      if (parsed === undefined) return undefined;
      return { name, scenario, params: parsed };
    }
    default:
      return undefined;
  }
}

export function registerDataPlane(app: Hono, deps: DataPlaneDeps): void {
  app.put(
    "/__fixture/:id/endpoints/:name",
    controlCors(),
    controlGuard(deps.token),
    (c) => registerEndpoint(c, deps),
  );
  app.all("/__fixture/:id/e/:name", (c) => serveEndpoint(c, deps));
  app.all("/__fixture/:id/e/:name/*", (c) => serveEndpoint(c, deps));
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 200 &&
    value <= 599
  );
}

function isNullBodyStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}

function parseRespond(value: unknown): ScenarioParams["respond"] | undefined {
  if (!isRecord(value)) return undefined;
  const status = own(value, "status");
  if (!isHttpStatus(status)) return undefined;
  const body = own(value, "body");
  if (body !== undefined && typeof body !== "string") return undefined;
  if (typeof body === "string" && isNullBodyStatus(status)) return undefined;
  const contentType = own(value, "contentType");
  if (contentType !== undefined && typeof contentType !== "string") {
    return undefined;
  }
  const headers = own(value, "headers");
  if (headers !== undefined && !isStringRecord(headers)) return undefined;
  const parsed: ScenarioParams["respond"] = { status };
  if (typeof body === "string") parsed.body = body;
  if (typeof contentType === "string") parsed.contentType = contentType;
  if (isStringRecord(headers)) parsed.headers = headers;
  return parsed;
}

function parseWs(value: unknown): ScenarioParams["ws"] | undefined {
  if (!isRecord(value)) return undefined;
  const sendValue = own(value, "send");
  if (!isUnknownArray(sendValue)) return undefined;
  const send: string[] = [];
  for (const message of sendValue) {
    if (typeof message !== "string") return undefined;
    send.push(message);
  }
  const closeWith = own(value, "closeWith");
  if (closeWith === undefined) return { send };
  if (!isRecord(closeWith)) return undefined;
  const code = own(closeWith, "code");
  const reason = own(closeWith, "reason");
  if (
    typeof code !== "number" ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 4999 ||
    typeof reason !== "string"
  ) {
    return undefined;
  }
  return { send, closeWith: { code, reason } };
}

function parseHang(value: unknown): ScenarioParams["hang"] | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 0) return undefined;
  return {};
}

function parseGzip(value: unknown): ScenarioParams["gzip"] | undefined {
  if (!isRecord(value)) return undefined;
  const body = own(value, "body");
  if (typeof body !== "string") return undefined;
  const status = own(value, "status");
  if (status !== undefined && !isHttpStatus(status)) return undefined;
  if (isHttpStatus(status) && isNullBodyStatus(status)) return undefined;
  const contentType = own(value, "contentType");
  if (contentType !== undefined && typeof contentType !== "string") {
    return undefined;
  }
  const parsed: ScenarioParams["gzip"] = { body };
  if (isHttpStatus(status)) parsed.status = status;
  if (typeof contentType === "string") parsed.contentType = contentType;
  return parsed;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    const body: unknown = await c.req.json();
    return body;
  } catch {
    return undefined;
  }
}

async function registerEndpoint(
  c: Context,
  deps: DataPlaneDeps,
): Promise<Response> {
  const id = c.req.param("id");
  const name = c.req.param("name");
  const host = new URL(c.req.url).host;
  if (id === undefined || name === undefined || host === "") {
    return c.body(null, 400);
  }
  const registration = parseEndpointRegistration(name, await readJson(c));
  if (registration === undefined) return c.body(null, 400);
  const state = deps.registry.get(id) ?? deps.registry.create(id);
  state.endpoints.set(registration.name, registration);
  return c.json({
    url: `http://${host}/__fixture/${id}/e/${registration.name}`,
  });
}

interface DataCors {
  readonly method: string;
  readonly origin: string | undefined;
  readonly requestHeaders: string | undefined;
}

function serveEndpoint(
  c: Context,
  deps: DataPlaneDeps,
): Response | Promise<Response> {
  const cors = dataCors(c);
  if (c.req.method === "OPTIONS") {
    return applyCors(new Response(null, { status: 204 }), cors);
  }
  const id = c.req.param("id");
  const name = c.req.param("name");
  if (id === undefined || name === undefined) {
    return applyCors(new Response(null, { status: 404 }), cors);
  }
  const state = deps.registry.get(id);
  if (state === undefined) {
    return applyCors(new Response(null, { status: 404 }), cors);
  }
  const registration = state.endpoints.get(name);
  if (registration === undefined) {
    return applyCors(new Response(null, { status: 404 }), cors);
  }
  const request = state.record({
    endpoint: name,
    method: c.req.method,
    path: relativePath(new URL(c.req.url).pathname),
    headers: requestHeaders(c),
  });
  if (isWebSocketUpgrade(c) && registration.scenario !== "ws") {
    return applyCors(new Response(null, { status: 400 }), cors);
  }
  switch (registration.scenario) {
    case "hang":
      return withheldScript(
        HANG,
        request,
        (connection) => state.track(name, connection),
        c.req.raw.signal,
      ).then((response) => applyCors(response, cors));
    case "respond":
      return respondResponse(registration.params, cors);
    case "gzip":
      return gzipResponse(registration.params, cors);
    case "script":
      return scriptResponse(
        registration.params.plan,
        request,
        (connection) => state.track(name, connection),
        c.req.raw.signal,
      ).then((response) => applyCors(response, cors));
    case "ws":
      if (!isWebSocketUpgrade(c)) {
        return applyCors(new Response(null, { status: 426 }), cors);
      }
      return acceptWebSocket(
        c,
        deps.upgradeWebSocket,
        state,
        name,
        request,
        registration.params,
      );
  }
}

/** A hung request is a held script step: it answers 204 when it is ended, and 499 when the client goes away. */
const HANG: ScriptStep = { status: 204, chunks: [], then: "hold" };

function isWebSocketUpgrade(c: Context): boolean {
  const upgrade = c.req.header("upgrade");
  return upgrade !== undefined && upgrade.toLowerCase() === "websocket";
}

function relativePath(pathname: string): string {
  // Params are decoded, so a prefix built from them misses a raw name such
  // as %61. Drop "", __fixture, id, e, and the name segment instead.
  const rest = pathname.split("/").slice(5).join("/");
  if (rest === "") return "/";
  return `/${rest}`;
}

function requestHeaders(c: Context): FixtureHeaders {
  const entries: [string, string][] = [];
  c.req.raw.headers.forEach((value, key) => {
    entries.push([key, value]);
  });
  return Object.fromEntries(entries);
}

const dataPlaneMethods = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";

function dataCors(c: Context): DataCors {
  return {
    method: c.req.method,
    origin: c.req.header("origin"),
    requestHeaders: c.req.header("access-control-request-headers"),
  };
}

function applyCors(response: Response, cors: DataCors): Response {
  const own = [...response.headers.keys()];
  if (cors.origin !== undefined) {
    response.headers.set("access-control-allow-origin", cors.origin);
    response.headers.set("access-control-allow-credentials", "true");
  }
  if (cors.method === "OPTIONS") {
    response.headers.set("access-control-allow-methods", dataPlaneMethods);
    if (cors.requestHeaders !== undefined) {
      response.headers.set("access-control-allow-headers", cors.requestHeaders);
    }
    response.headers.set("access-control-max-age", "86400");
    return response;
  }
  if (own.length > 0) {
    response.headers.set("access-control-expose-headers", own.join(","));
  }
  return response;
}

function respondResponse(
  params: ScenarioParams["respond"],
  cors: DataCors,
): Response {
  const headers = new Headers();
  if (params.headers !== undefined) {
    for (const [name, value] of Object.entries(params.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
  }
  if (params.contentType !== undefined) {
    headers.set("content-type", params.contentType);
  }
  return applyCors(
    new Response(params.body === undefined ? null : params.body, {
      status: params.status,
      headers,
    }),
    cors,
  );
}

async function gzipResponse(
  params: ScenarioParams["gzip"],
  cors: DataCors,
): Promise<Response> {
  const compressed = await gzipEncode(params.body);
  const headers = new Headers({
    "content-encoding": "gzip",
    "content-length": String(compressed.byteLength),
  });
  if (params.contentType !== undefined) {
    headers.set("content-type", params.contentType);
  }
  return applyCors(
    new Response(bufferOf(compressed), {
      status: params.status ?? 200,
      headers,
    }),
    cors,
  );
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function gzipEncode(text: string): Promise<Uint8Array> {
  const compressed = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

function acceptWebSocket(
  c: Context,
  upgradeWebSocket: UpgradeWebSocket,
  state: FixtureState,
  name: string,
  request: number,
  params: ScenarioParams["ws"],
): Response | Promise<Response> {
  let opened: WSContext | undefined;
  let settled = false;
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let untrack = (): void => undefined;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    untrack();
    resolveClosed();
  };
  untrack = state.track(name, {
    request,
    apply(action) {
      if (settled || action === "drop") return Promise.resolve(false);
      const socket = opened;
      if (socket === undefined) return Promise.resolve(false);
      if (action === "end") {
        socket.close(1000);
        return closed.then(() => true);
      }
      if (action === "terminate") {
        terminateSocket(socket.raw);
        return closed.then(() => true);
      }
      return Promise.resolve(false);
    },
    release() {
      if (settled) return Promise.resolve();
      const socket = opened;
      if (socket === undefined) {
        finish();
        return Promise.resolve();
      }
      socket.close(1001);
      return closed.then(() => undefined);
    },
  });
  return upgradeWebSocket(c, {
    onOpen(_event, ws) {
      opened = ws;
      for (const message of params.send) ws.send(message);
      if (params.closeWith !== undefined) {
        const closeWith = params.closeWith;
        // Same pad as /ws/error-before-close. Firefox drops `open` when the
        // close is already buffered at the handshake.
        setTimeout(() => {
          ws.close(closeWith.code, closeWith.reason);
        }, 200);
      }
    },
    onClose() {
      finish();
    },
    onError() {
      finish();
    },
  });
}

function terminateSocket(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  if (!("terminate" in raw)) return;
  const terminate: unknown = Reflect.get(raw, "terminate");
  if (typeof terminate !== "function") return;
  Reflect.apply(terminate, raw, []);
}

function isStepThen(value: unknown): value is StepThen {
  switch (value) {
    case "end":
    case "hold":
    case "drop":
    case "terminate":
      return true;
    default:
      return false;
  }
}

function parseScript(value: unknown): ScenarioParams["script"] | undefined {
  if (!isRecord(value)) return undefined;
  const plan = own(value, "plan");
  if (!isUnknownArray(plan) || plan.length === 0) return undefined;
  const steps: ScriptStep[] = [];
  for (const step of plan) {
    const parsed = parseScriptStep(step);
    if (parsed === undefined) return undefined;
    steps.push(parsed);
  }
  return { plan: steps };
}

function parseScriptStep(value: unknown): ScriptStep | undefined {
  if (!isRecord(value)) return undefined;
  const status = own(value, "status");
  if (!isHttpStatus(status)) return undefined;
  const chunksValue = own(value, "chunks");
  if (!isUnknownArray(chunksValue)) return undefined;
  const chunks: string[] = [];
  for (const chunk of chunksValue) {
    if (typeof chunk !== "string") return undefined;
    chunks.push(chunk);
  }
  const then = own(value, "then");
  if (!isStepThen(then)) return undefined;
  if (isNullBodyStatus(status)) {
    if (chunks.length > 0) return undefined;
    if (then !== "end" && then !== "hold") return undefined;
  }
  const headers = own(value, "headers");
  if (headers !== undefined && !isStringRecord(headers)) return undefined;
  if (isStringRecord(headers)) return { status, chunks, then, headers };
  return { status, chunks, then };
}

function scriptResponse(
  plan: readonly ScriptStep[],
  index: number,
  track: (connection: LiveConnection) => () => void,
  signal: AbortSignal,
): Promise<Response> {
  const step = plan[Math.min(index, plan.length - 1)];
  if (step === undefined) {
    return Promise.resolve(new Response(null, { status: 400 }));
  }
  if (step.then === "hold" && step.chunks.length === 0) {
    return withheldScript(step, index, track, signal);
  }
  if (
    isNullBodyStatus(step.status) ||
    (step.chunks.length === 0 && step.then === "end")
  ) {
    return Promise.resolve(scriptMessage(step, null));
  }
  return streamedScript(step, index, track, signal);
}

function scriptMessage(step: ScriptStep, body: BodyInit | null): Response {
  const headers = new Headers();
  if (step.headers !== undefined) {
    for (const [name, value] of Object.entries(step.headers)) {
      headers.set(name, value);
    }
  }
  return new Response(isNullBodyStatus(step.status) ? null : body, {
    status: step.status,
    headers,
  });
}

function withheldScript(
  step: ScriptStep,
  index: number,
  track: (connection: LiveConnection) => () => void,
  signal: AbortSignal,
): Promise<Response> {
  let settled = false;
  let resolveResponse: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  let untrack = (): void => undefined;
  const finish = (response: Response): void => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", onAbort);
    untrack();
    resolveResponse(response);
  };
  const onAbort = (): void => {
    finish(new Response(null, { status: 499 }));
  };
  untrack = track({
    request: index,
    apply(action) {
      if (settled || action !== "end") return Promise.resolve(false);
      finish(scriptMessage(step, null));
      return Promise.resolve(true);
    },
    release() {
      if (!settled) finish(scriptMessage(step, null));
      return Promise.resolve();
    },
  });
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort);
  return pending;
}

interface PullWaiter {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly resolve: () => void;
}

/** How a streamed step ends. An abort outranks an interruption, and an interruption outranks a requested end. */
type StreamEnd = "ended" | "drop" | "terminate" | "aborted";

const STREAM_END_RANK: Readonly<Record<StreamEnd, number>> = {
  ended: 1,
  drop: 2,
  terminate: 2,
  aborted: 3,
};

function streamedScript(
  step: ScriptStep,
  index: number,
  track: (connection: LiveConnection) => () => void,
  signal: AbortSignal,
): Promise<Response> {
  const encoder = new TextEncoder();
  let cursor = 0;
  let outcome: StreamEnd | undefined;
  let settled = false;
  let untrack = (): void => undefined;
  let waiter: PullWaiter | undefined;

  const decide = (next: StreamEnd): StreamEnd => {
    if (
      outcome === undefined ||
      STREAM_END_RANK[next] >= STREAM_END_RANK[outcome]
    ) {
      outcome = next;
    }
    return outcome;
  };
  const finish = (): void => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", onAbort);
    untrack();
  };
  const conclude = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    how: StreamEnd,
  ): void => {
    finish();
    switch (how) {
      case "ended":
        controller.close();
        return;
      case "aborted":
        controller.error(
          new DOMException("The operation was aborted.", "AbortError"),
        );
        return;
      default:
        controller.error(new Error(`fixture ${how}`));
    }
  };
  /** Ends the pull that is waiting, if there is one, the way `how` says. */
  const wake = (how: StreamEnd): boolean => {
    if (waiter === undefined) return false;
    const pending = waiter;
    waiter = undefined;
    conclude(pending.controller, how);
    pending.resolve();
    return true;
  };
  const onAbort = (): void => {
    decide("aborted");
    if (!wake("aborted")) finish();
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (outcome !== undefined) {
          conclude(controller, outcome);
          return;
        }
        if (cursor < step.chunks.length) {
          const chunk = step.chunks[cursor];
          if (chunk === undefined) {
            conclude(controller, "drop");
            return;
          }
          controller.enqueue(encoder.encode(chunk));
          cursor += 1;
          return;
        }
        if (step.then === "drop" || step.then === "terminate") {
          // Bun.serve pulls the error before it flushes the preceding chunk,
          // which resets the socket before the client sees the response.
          const kind = step.then;
          return yieldMacrotask().then(() => {
            conclude(controller, outcome ?? kind);
          });
        }
        if (step.then === "end") {
          conclude(controller, "ended");
          return;
        }
        return new Promise<void>((resolve) => {
          waiter = { controller, resolve };
        });
      },
      cancel() {
        finish();
      },
    },
    { highWaterMark: 0 },
  );
  const apply = (action: ActionKind): Promise<boolean> => {
    if (settled) return Promise.resolve(false);
    const how = decide(action === "end" ? "ended" : action);
    // A requested end with nothing waiting stops the connection from being live; an interruption waits for the next pull.
    if (!wake(how) && action === "end") finish();
    return Promise.resolve(true);
  };
  untrack = track({
    request: index,
    apply,
    release: () => apply("end").then(() => undefined),
  });
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort);
  return Promise.resolve(scriptMessage(step, stream));
}
