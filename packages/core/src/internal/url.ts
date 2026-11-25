import type { QuerySerializer } from "../client/config";
import { isPlainObject } from "../struct/plain_object";
import type { HttpRequest } from "../http/http_request";
import { isURLSearchParams } from "./type_guards";

export class RequestUrlError extends TypeError {}

export interface PathTemplatePart {
  readonly literal: string;
  readonly param: string;
}

export type CompiledPathTemplate =
  | {
      readonly kind: "single";
      readonly prefix: string;
      readonly param: string;
      readonly suffix: string;
    }
  | {
      readonly kind: "multi";
      readonly parts: readonly PathTemplatePart[];
      readonly tail: string;
    };

const PATH_PARAM_RE = /:[^/]+/g;

export function compilePathTemplate(
  path: string,
): CompiledPathTemplate | undefined {
  if (!path.includes(":")) {
    return undefined;
  }
  let first: PathTemplatePart | undefined;
  let parts: PathTemplatePart[] | undefined;
  let lastIndex = 0;
  PATH_PARAM_RE.lastIndex = 0;
  let match = PATH_PARAM_RE.exec(path);
  while (match !== null) {
    const part: PathTemplatePart = {
      literal: path.slice(lastIndex, match.index),
      param: path.slice(match.index + 1, match.index + match[0].length),
    };
    if (first === undefined) {
      first = part;
    } else {
      parts ??= [first];
      parts.push(part);
    }
    lastIndex = match.index + match[0].length;
    match = PATH_PARAM_RE.exec(path);
  }
  if (first === undefined) {
    return undefined;
  }
  const tail = path.slice(lastIndex);
  return parts === undefined
    ? {
        kind: "single",
        prefix: first.literal,
        param: first.param,
        suffix: tail,
      }
    : {
        kind: "multi",
        parts,
        tail,
      };
}

export function fillCompiledPath(
  path: string,
  template: CompiledPathTemplate | undefined,
  params?: { [key: string]: string },
): string {
  if (template === undefined) {
    if (params !== undefined) {
      for (const [key, value] of Object.entries(params)) {
        encodePathSegment(key, value);
      }
    }
    return path;
  }

  if (template.kind === "single") {
    let encoded: string | undefined;
    if (params !== undefined) {
      for (const [key, value] of Object.entries(params)) {
        const segment = encodePathSegment(key, value);
        if (key === template.param) {
          encoded = segment;
        }
      }
    }
    if (encoded === undefined) {
      throw new TypeError(`Missing path param: ${template.param}`);
    }
    return `${template.prefix}${encoded}${template.suffix}`;
  }

  const paramMap = new Map<string, string>();
  if (params !== undefined) {
    for (const [key, value] of Object.entries(params)) {
      paramMap.set(key, encodePathSegment(key, value));
    }
  }
  let result = "";
  for (const part of template.parts) {
    const value = paramMap.get(part.param);
    if (value === undefined) {
      throw new TypeError(`Missing path param: ${part.param}`);
    }
    result += part.literal + value;
  }
  return result + template.tail;
}

export function fillUrl(
  path: string,
  params?: { [key: string]: string },
): string {
  return fillCompiledPath(path, compilePathTemplate(path), params);
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

export function createSearchParams(query: {
  [key: string]: unknown;
}): URLSearchParams {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    appendToSearchParams(searchParams, key, value);
  }

  return searchParams;
}

/**
 * The query a request carries. A `URLSearchParams` from the builder is copied, so that an interceptor that changes
 * the request's query does not change the builder's own instance. A serializer's string is parsed, so that the wire
 * form is always `query.toString()`.
 */
export function resolveTransportQuery(
  query: URLSearchParams | { [key: string]: unknown } | undefined,
  serializer?: QuerySerializer,
): URLSearchParams {
  if (isURLSearchParams(query)) {
    return new URLSearchParams(query);
  }

  if (!isPlainObject(query)) {
    return new URLSearchParams();
  }

  return serializer
    ? new URLSearchParams(serializer(query))
    : createSearchParams(query);
}

/** Encodes a query directly to its wire search string without allocating an empty URLSearchParams when absent. */
export function resolveDirectQueryString(
  query: URLSearchParams | { [key: string]: unknown } | undefined,
  serializer?: QuerySerializer,
): string {
  if (query === undefined) {
    return "";
  }
  if (isURLSearchParams(query)) {
    return query.toString();
  }
  return resolveTransportQuery(query, serializer).toString();
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
 * @param search - The URL's search without a leading `?`, as `URLSearchParams.toString()` gives it. When non-empty it is set as the URL's `search`.
 * @returns the resolved `URL`.
 * @group http
 */
export function createResolvedRequestUrl(
  baseEndpoint: string,
  path: string,
  search = "",
): URL {
  const base = createEndpointDirectoryBase(baseEndpoint);
  let url: URL;
  const relativePath =
    path.charCodeAt(0) === 0x2f && path.charCodeAt(1) !== 0x2f
      ? path.slice(1)
      : path;
  try {
    url = new URL(relativePath, base);
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
  if (search) {
    url.search = search;
  }
  return url;
}

/** The URL of `request`: its endpoint under its base endpoint, with its query. */
export function resolveRequestUrl(request: HttpRequest): URL {
  if (!request.baseEndpoint) {
    throw new RequestUrlError("Client endpoint is required");
  }
  return createResolvedRequestUrl(
    request.baseEndpoint,
    request.endpoint,
    request.query?.toString(),
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
