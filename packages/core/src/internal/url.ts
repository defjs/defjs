import type { QuerySerializer } from "../client/config";
import { isPlainObject } from "../struct/utils";
import type { HttpRequest } from "../http/http_request";
import { isURLSearchParams } from "./type_guards";

export class RequestUrlError extends TypeError {}

export function fillUrl(
  path: string,
  params?: { [key: string]: string },
): string {
  const paramMap = new Map<string, string>();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      paramMap.set(key, encodePathSegment(key, value));
    }
  }

  return path.replace(/:([^/]+)/g, (_, part: string) => {
    const value = paramMap.get(part);
    if (value === undefined) {
      throw new TypeError(`Missing path param: ${part}`);
    }
    return value;
  });
}

function encodePathSegment(key: string, value: string): string {
  if (value === "") {
    throw new TypeError(
      `path value for "${key}" must be a non-empty path segment`,
    );
  }
  if (value === "." || value === "..") {
    throw new TypeError(`path value for "${key}" must not be a dot segment`);
  }
  return encodeURIComponent(value);
}

export function createSearchParams(query?: {
  [key: string]: unknown;
}): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (!query) {
    return searchParams;
  }

  for (const [key, value] of Object.entries(query)) {
    appendToSearchParams(searchParams, key, value);
  }

  return searchParams;
}

export function resolveTransportQuery(
  query: URLSearchParams | { [key: string]: unknown } | undefined,
  serializer?: QuerySerializer,
): { queryParams: URLSearchParams; queryString: string } {
  if (isURLSearchParams(query)) {
    return { queryParams: query, queryString: query.toString() };
  }

  if (!isPlainObject(query)) {
    const queryParams = createSearchParams();
    return { queryParams, queryString: queryParams.toString() };
  }

  if (!serializer) {
    const queryParams = createSearchParams(query);
    return { queryParams, queryString: queryParams.toString() };
  }

  const queryString = serializer(query);
  return {
    queryParams: new URLSearchParams(queryString),
    queryString,
  };
}

/**
 * Copies `source` into `target`. The first value of a name replaces the target's value of that name, so a builder
 * header overrides a default; later values of the same name, such as each Set-Cookie, are appended.
 */
export function mergeHeaders(target: Headers, source: Headers): void {
  const replaced = new Set<string>();
  source.forEach((value, name) => {
    if (replaced.has(name)) {
      target.append(name, value);
    } else {
      target.set(name, value);
      replaced.add(name);
    }
  });
}

/**
 * Resolves a relative definition path under the base endpoint's origin and directory into a URL.
 *
 * During an operation, a missing, relative, or invalid base or an illegal
 * path becomes `REQ_BUILD_FAILED` before any interceptor or transport runs,
 * including a short-circuiting interceptor, for HTTP, SSE, and WebSocket alike.
 * An interceptor's final `req.endpoint` is also validated against its final
 * `req.baseEndpoint`; deliberately replacing the base with another valid
 * absolute URL is allowed. Deterministic URL errors are never retried.
 *
 * @throws TypeError when the endpoint or path is invalid.
 * @param baseEndpoint - A valid absolute client endpoint. Its query and hash are dropped, and a trailing slash is added to its pathname so that the base path is kept: `https://api.example.com/v1` with `/users` gives `https://api.example.com/v1/users`.
 * @param path - A relative endpoint path. A single leading slash is removed. After resolution, the URL must keep the base origin and stay under its directory. Absolute or protocol-relative paths, C0 control characters (including tab, CR, and LF), backslashes, `?`, `#`, and directory escapes are rejected. Scheme-like and protocol-relative forms are rejected even with leading spaces; a plain inner space is allowed and sent as `%20`.
 * @param queryString - Query without a leading `?`. When non-empty it is set as the URL's search verbatim.
 * @returns the resolved `URL`.
 * @group http
 */
export function createResolvedRequestUrl(
  baseEndpoint: string,
  path: string,
  queryString = "",
): URL {
  const base = createEndpointDirectoryBase(baseEndpoint);
  let url: URL;
  try {
    url = new URL(path.replace(/^\/(?!\/)/, ""), base);
  } catch {
    throw new RequestUrlError("Endpoint path must resolve to a valid URL");
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new RequestUrlError(
      "Endpoint path must not be an absolute URL or leave the client endpoint directory",
    );
  }
  validateEndpointPath(path);
  // The validated path carries no query, so an empty string would only reassign an empty search.
  if (queryString) {
    url.search = queryString;
  }
  return url;
}

/** The URL of `request`: its endpoint under its base endpoint, with its query string. */
export function resolveRequestUrl(request: HttpRequest): URL {
  if (!request.baseEndpoint) {
    throw new RequestUrlError("Client endpoint is required");
  }
  const queryString =
    typeof request.queryString === "string"
      ? request.queryString
      : request.queryParams
        ? request.queryParams.toString()
        : "";
  return createResolvedRequestUrl(
    request.baseEndpoint,
    request.endpoint,
    queryString,
  );
}

function appendToSearchParams(
  searchParams: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined) {
        appendQueryLeaf(searchParams, key, item);
      }
    }
    return;
  }

  appendQueryLeaf(searchParams, key, value);
}

function appendQueryLeaf(
  searchParams: URLSearchParams,
  key: string,
  value: unknown,
): void {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      searchParams.append(key, String(value));
      return;
    default:
      throw new TypeError(
        `a query serializer is required for nested query value "${key}"`,
      );
  }
}

// One client usually talks to one endpoint. `new URL(path, base)` only reads the base, so it is shared.
let lastEndpoint: string | undefined;
let lastBase: URL | undefined;

function createEndpointDirectoryBase(baseEndpoint: string): URL {
  if (baseEndpoint === lastEndpoint && lastBase !== undefined) {
    return lastBase;
  }
  let base: URL;
  try {
    base = new URL(baseEndpoint);
  } catch {
    throw new RequestUrlError("Client endpoint must be a valid URL");
  }

  base.search = "";
  base.hash = "";

  if (!base.pathname.endsWith("/")) {
    base.pathname = `${base.pathname}/`;
  }

  lastEndpoint = baseEndpoint;
  lastBase = base;
  return base;
}

function hasC0ControlOrBackslash(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code <= 0x1f || code === 0x5c) {
      return true;
    }
  }
  return false;
}

function validateEndpointPath(path: string): void {
  if (URL.canParse(path) || /^ *\/\//.test(path)) {
    throw new RequestUrlError("Endpoint path must not be an absolute URL");
  }

  if (path.includes("?") || path.includes("#")) {
    throw new RequestUrlError("Endpoint path must not include query or hash");
  }

  // C0 controls are an intentional request URL security boundary.
  if (hasC0ControlOrBackslash(path)) {
    throw new RequestUrlError(
      "Endpoint path must not include C0 controls or backslashes",
    );
  }
}
