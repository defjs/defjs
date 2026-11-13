import type { FixtureRegistry } from "./state.ts";
import type {
  RawHandler,
  RawReply,
  RawRequestHead,
  RawScenarioName,
} from "./types.ts";

const allowOrigin = "access-control-allow-origin: *";
const allowMethods =
  "access-control-allow-methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
const allowHeaders = "access-control-allow-headers: *";

export function readRawHead(
  received: string,
): Omit<RawRequestHead, "connection"> | undefined {
  const end = received.indexOf("\r\n\r\n");
  if (end < 0) {
    return undefined;
  }
  const rawHead = received.slice(0, end + 4);
  const lines = rawHead.slice(0, end).split("\r\n");
  const requestLine = lines[0];
  if (requestLine === undefined) {
    return undefined;
  }
  const parts = requestLine.split(" ");
  if (parts.length !== 3) {
    return undefined;
  }
  const method = parts[0];
  const target = parts[1];
  const version = parts[2];
  if (
    method === undefined ||
    target === undefined ||
    version === undefined ||
    method === "" ||
    target === "" ||
    version === ""
  ) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    if (name === "") {
      continue;
    }
    headers[name] = line.slice(colon + 1).trim();
  }
  return { method, target, headers, rawHead };
}

export function rawArguments(
  target: string,
  scenario: RawScenarioName,
): string[] {
  const pathname = target.split("?")[0] ?? "";
  const marker = `/raw/${scenario}`;
  const at = pathname.indexOf(marker);
  let rest = "";
  if (at >= 0) {
    const after = at + marker.length;
    const boundary = pathname[after];
    if (boundary === undefined || boundary === "/") {
      rest = pathname.slice(after);
    }
  }
  const parts = rest.split("/");
  let start = 0;
  while (start < parts.length && parts[start] === "") start += 1;
  let end = parts.length;
  if (end > start && parts[end - 1] === "") end -= 1;
  const args: string[] = [];
  for (let index = start; index < end; index += 1) {
    const segment = parts[index];
    if (segment === undefined) continue;
    args.push(decodeURIComponent(segment));
  }
  return args;
}

function scenarioArguments(
  target: string,
  scenario: RawScenarioName,
): string[] | undefined {
  try {
    return rawArguments(target, scenario);
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

export function createRawHandler(registry: FixtureRegistry): RawHandler {
  return (head) => {
    if (head.method === "OPTIONS") {
      return reply(
        message("HTTP/1.1 204 No Content", [
          allowOrigin,
          allowMethods,
          allowHeaders,
          "connection: close",
        ]),
      );
    }
    const route = parseTarget(head.target);
    if (route === undefined) return notFound();
    switch (route.scenario) {
      case "truncated":
        return truncated(registry, head, route);
      case "utf8-last-event-id":
        return utf8LastEventId(registry, head, route);
      case "partial-frame-resume":
        return partialFrameResume(registry, head, route);
      case "reset-before-headers":
        return resetBeforeHeaders(registry, head, route);
      default:
        return notFound();
    }
  };
}

function truncated(
  registry: FixtureRegistry,
  head: RawRequestHead,
  route: RawTarget,
): RawReply {
  const args = scenarioArguments(head.target, "truncated");
  if (args === undefined) return notFound();
  const status = truncatedStatus(args);
  if (status === undefined) return notFound();
  recordRaw(registry, head, route);
  return reply(
    message(
      `HTTP/1.1 ${status} Response`,
      [
        allowOrigin,
        "content-type: application/json",
        "transfer-encoding: chunked",
        "connection: close",
      ],
      'b\r\n{"partial":\r\n',
    ),
  );
}

function utf8LastEventId(
  registry: FixtureRegistry,
  head: RawRequestHead,
  route: RawTarget,
): RawReply {
  const segments = scenarioArguments(head.target, "utf8-last-event-id");
  if (segments === undefined) return notFound();
  const request = recordRaw(registry, head, route);
  const id = segments.at(-1) ?? "";
  if (head.headers["last-event-id"] !== undefined) {
    return reply(sse(chunk("data: second\n\n") + "0\r\n\r\n"));
  }
  return hold(
    registry,
    route,
    head.connection,
    request,
    sse(chunk(`id: ${id}\ndata: first\n\n`)),
  );
}

function partialFrameResume(
  registry: FixtureRegistry,
  head: RawRequestHead,
  route: RawTarget,
): RawReply {
  if (scenarioArguments(head.target, "partial-frame-resume") === undefined) {
    return notFound();
  }
  const request = recordRaw(registry, head, route);
  const last = head.headers["last-event-id"];
  if (last === undefined) {
    return hold(
      registry,
      route,
      head.connection,
      request,
      sse(chunk("id: 1\ndata: first\n\nid: 2\n")),
    );
  }
  const payload =
    last === "1" ? "id: 2\ndata: second\n\n" : "id: 3\ndata: skipped\n\n";
  return reply(sse(chunk(payload) + "0\r\n\r\n"));
}

function resetBeforeHeaders(
  registry: FixtureRegistry,
  head: RawRequestHead,
  route: RawTarget,
): RawReply {
  if (scenarioArguments(head.target, "reset-before-headers") === undefined) {
    return notFound();
  }
  recordRaw(registry, head, route);
  return reply("", "terminate");
}

function sse(body: string): string {
  return message(
    "HTTP/1.1 200 OK",
    [
      allowOrigin,
      "content-type: text/event-stream",
      "transfer-encoding: chunked",
      "connection: close",
    ],
    body,
  );
}

function chunk(payload: string): string {
  const size = new TextEncoder().encode(payload).byteLength.toString(16);
  return `${size}\r\n${payload}\r\n`;
}

function recordRaw(
  registry: FixtureRegistry,
  head: RawRequestHead,
  route: RawTarget,
): number | undefined {
  const state = registry.get(route.id);
  if (state === undefined) return undefined;
  return state.record({
    endpoint: `raw:${route.scenario}`,
    method: head.method,
    path: route.path,
    headers: head.headers,
    rawHead: head.rawHead,
  });
}

function hold(
  registry: FixtureRegistry,
  route: RawTarget,
  connection: RawRequestHead["connection"],
  request: number | undefined,
  text: string,
): RawReply {
  if (request !== undefined) {
    trackRaw(registry, route, connection, request);
  }
  return reply(text, "hold");
}

function trackRaw(
  registry: FixtureRegistry,
  route: RawTarget,
  connection: RawRequestHead["connection"],
  request: number,
): void {
  const state = registry.get(route.id);
  if (state === undefined) return;
  let untrack = (): void => undefined;
  let settled = false;
  const encoder = new TextEncoder();
  const finish = (): void => {
    if (settled) return;
    settled = true;
    untrack();
  };
  untrack = state.track(`raw:${route.scenario}`, {
    request,
    apply(action) {
      if (settled) return Promise.resolve(false);
      finish();
      switch (action) {
        case "end":
          connection.write(encoder.encode("0\r\n\r\n"));
          return connection.end().then(() => true);
        case "drop":
          return connection.end().then(() => true);
        case "terminate":
          return connection.terminate().then(() => true);
      }
    },
    release() {
      if (settled) return Promise.resolve();
      finish();
      return connection.terminate().then(() => undefined);
    },
  });
}

function message(
  statusLine: string,
  headers: readonly string[],
  body = "",
): string {
  return `${[statusLine, ...headers, "", ""].join("\r\n")}${body}`;
}

function reply(text: string, then: RawReply["then"] = "end"): RawReply {
  return { bytes: new TextEncoder().encode(text), then };
}

function notFound(): RawReply {
  return reply(
    message("HTTP/1.1 404 Not Found", [
      allowOrigin,
      allowMethods,
      allowHeaders,
      "content-length: 0",
      "connection: close",
    ]),
  );
}

interface RawTarget {
  readonly id: string;
  readonly scenario: string;
  readonly path: string;
}

function parseTarget(target: string): RawTarget | undefined {
  const pathname = target.split("?")[0];
  if (pathname === undefined) {
    return undefined;
  }
  const matched = /^\/__fixture\/([^/]+)\/raw\/([^/]+)(\/.*)?$/.exec(pathname);
  if (matched === null) {
    return undefined;
  }
  const id = matched[1];
  const scenario = matched[2];
  if (id === undefined || scenario === undefined) {
    return undefined;
  }
  const rest = matched[3] ?? "";
  return {
    id,
    scenario,
    path: rest === "" ? "/" : rest,
  };
}

function truncatedStatus(args: readonly string[]): number | undefined {
  const decoded = args[0];
  if (decoded === undefined) return 200;
  if (!/^\d+$/.test(decoded)) return undefined;
  const status = Number(decoded);
  if (String(status) !== decoded || status < 100 || status > 599) {
    return undefined;
  }
  return status;
}
