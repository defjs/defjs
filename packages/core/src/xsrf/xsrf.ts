import type { ClientOption } from "../client/option";
import type { HttpRequest } from "../internal/http_request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/**
 * Cookie and header names for {@link withXSRF}.
 *
 * `cookieName` defaults to `XSRF-TOKEN` and `headerName` to `X-XSRF-TOKEN` when omitted.
 * The token is read from `document.cookie`. An empty value means no header.
 * A token from another source is set with an interceptor.
 *
 * @group client
 * @see {@link withXSRF}
 */
export interface XSRFOptions {
  /** Cookie name that stores the XSRF token. Defaults to `XSRF-TOKEN`. */
  cookieName?: string;
  /** Request header name that receives the token. Defaults to `X-XSRF-TOKEN`. */
  headerName?: string;
}

interface ResolvedXsrf {
  cookieName: string;
  headerName: string;
}

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

// A Worker can have `location` and still has no `document`.
export function assertXsrfRuntime(scope: {
  readonly location?: unknown;
  readonly document?: unknown;
}): void {
  if (scope.location === undefined) {
    throw new Error(
      "withXSRF requires a browser runtime: globalThis.location is missing",
    );
  }
  if (scope.document === undefined) {
    throw new Error(
      "withXSRF requires a browser runtime: globalThis.document is missing",
    );
  }
}

function readCookie(name: string): string | undefined {
  try {
    const cookie = document.cookie;
    if (cookie === "") {
      return undefined;
    }
    for (const part of cookie.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (rawName === name) {
        return decodeURIComponent(rawValue.join("="));
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function applyXsrfHeader(
  request: HttpRequest,
  headers: Headers,
  url: URL,
  xsrf: ResolvedXsrf,
): void {
  if (isSafeMethod(request.method)) {
    return;
  }
  if (headers.has(xsrf.headerName)) {
    return;
  }
  if (url.origin !== location.origin) {
    return;
  }
  const token = readCookie(xsrf.cookieName);
  if (token === undefined || token === "") {
    return;
  }
  headers.set(xsrf.headerName, token);
}

/**
 * Enables XSRF cookie-to-header forwarding for browser HTTP requests.
 *
 * Import this from `@defjs/core/xsrf`. Calling it checks `globalThis` immediately and
 * throws when `location` or `document` is missing, including in a Worker. Isomorphic
 * code adds this option only in the browser. It sets `config.finalizeHeaders`, which the
 * HTTP transport calls once per attempt. The hook receives the outgoing headers after
 * interceptors and before the default `Accept` is filled in, plus the resolved URL.
 * SSE and WebSocket requests do not get the header.
 * `cookieName` defaults to `XSRF-TOKEN` and `headerName` to `X-XSRF-TOKEN` when names
 * are omitted.
 *
 * - The header is set only when all of these hold: the method is not `GET`, `HEAD`, `OPTIONS`, or `TRACE`; the request does not already have that header; `url.origin` equals the page origin; and `document.cookie` holds a non-empty token. A cross-origin request does not read the cookie.
 * - A throw while reading the cookie counts as no token. An empty token does not set the header.
 * - The origin check covers the URL the library builds. Fetch follows redirects itself, and after a redirect to another origin it removes only `Authorization`, so this header goes along. The target receives the token when it allows the header in its CORS preflight. To refuse that, pass {@link withHTTPHandle} a function that calls `fetch(new Request(request, { mode: "same-origin" }))` for requests to the page origin that carry the header. Do not apply that mode to a cross-origin API whose header comes from an interceptor: Fetch rejects any request to another origin in that mode. Such a request fails with `NET_UNREACHABLE` when a redirect leaves the origin and still follows a same-origin redirect. With `Referrer-Policy: no-referrer`, Fetch sends `Origin: null` for a same-origin POST in that mode, where the default mode sends the serialized origin, so a server that checks `Origin` can reject it. Some engines implement this differently.
 * - A token from another source is set with an interceptor.
 *
 * @param options - Cookie name and header name.
 * @returns An option that sets `config.finalizeHeaders`.
 * @group client
 * @see {@link XSRFOptions}
 * @see {@link ClientOption}
 */
export function withXSRF(options: XSRFOptions = {}): ClientOption {
  assertXsrfRuntime(globalThis);
  return (config) => {
    const cookieName = options.cookieName ?? "XSRF-TOKEN";
    const headerName = options.headerName ?? "X-XSRF-TOKEN";
    config.finalizeHeaders = (request, headers, url) => {
      applyXsrfHeader(request, headers, url, {
        cookieName,
        headerName,
      });
    };
  };
}
