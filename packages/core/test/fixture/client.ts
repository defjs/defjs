import { isRecord, isStringRecord, isUnknownArray, own } from "./records.ts";
import type {
  ActionKind,
  LoggedRequest,
  LogResponse,
  RawScenarioName,
  ScenarioName,
  ScenarioParams,
} from "./types.ts";

export interface FixtureClient {
  readonly id: string;
  endpoint<S extends ScenarioName>(
    name: string,
    scenario: S,
    params: ScenarioParams[S],
  ): Promise<string>;
  act(
    target: string,
    action: ActionKind,
    options?: { request?: number },
  ): Promise<void>;
  log(options?: { wait?: number }): Promise<LogResponse>;
  rawUrl(
    rawOrigin: string,
    scenario: RawScenarioName,
    ...segments: readonly string[]
  ): string;
  delete(): Promise<void>;
}

export function createFixtureClient(
  host: string,
  token: string,
): FixtureClient {
  const id = crypto.randomUUID();
  // Vitest runs afterEach before onTestFinished, so keep this test's fetch.
  const http = globalThis.fetch;

  return {
    id,
    async endpoint(name, scenario, params) {
      const payload = await send(
        http,
        host,
        token,
        "PUT",
        `/__fixture/${id}/endpoints/${encodeURIComponent(name)}`,
        { scenario, params },
      );
      if (!isRecord(payload)) throw new Error("malformed endpoint response");
      const url = own(payload, "url");
      if (typeof url !== "string") {
        throw new Error("malformed endpoint response");
      }
      return url;
    },
    async act(target, action, options) {
      const body: { target: string; action: ActionKind; request?: number } = {
        target,
        action,
      };
      if (options?.request !== undefined) body.request = options.request;
      await send(http, host, token, "POST", `/__fixture/${id}/actions`, body);
    },
    async log(options) {
      const query = options?.wait === undefined ? "" : `?wait=${options.wait}`;
      return parseLog(
        await send(http, host, token, "GET", `/__fixture/${id}/log${query}`),
      );
    },
    rawUrl(rawOrigin, scenario, ...segments) {
      let url = `${rawOrigin}/__fixture/${id}/raw/${scenario}`;
      for (const segment of segments) {
        url += `/${encodeURIComponent(segment)}`;
      }
      return url;
    },
    async delete() {
      await send(http, host, token, "DELETE", `/__fixture/${id}`);
    },
  };
}

async function send(
  http: typeof fetch,
  host: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers = new Headers();
  headers.set("x-fixture-token", token);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const response = await http(`${host}${path}`, init);
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text === "") return undefined;
  return parseJson(text);
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function parseLog(value: unknown): LogResponse {
  if (!isRecord(value)) throw new Error("malformed log response");
  const requests = own(value, "requests");
  if (!isUnknownArray(requests)) throw new Error("malformed log response");
  const parsed: LoggedRequest[] = [];
  for (const request of requests) {
    const item = parseLogged(request);
    if (item === undefined) throw new Error("malformed log response");
    parsed.push(item);
  }
  return { requests: parsed };
}

function parseLogged(value: unknown): LoggedRequest | undefined {
  if (!isRecord(value)) return undefined;
  const endpoint = own(value, "endpoint");
  const method = own(value, "method");
  const path = own(value, "path");
  const headers = own(value, "headers");
  if (
    typeof endpoint !== "string" ||
    typeof method !== "string" ||
    typeof path !== "string" ||
    !isStringRecord(headers)
  ) {
    return undefined;
  }
  const rawHead = own(value, "rawHead");
  if (rawHead !== undefined && typeof rawHead !== "string") return undefined;
  if (typeof rawHead === "string") {
    return { endpoint, method, path, headers, rawHead };
  }
  return { endpoint, method, path, headers };
}
