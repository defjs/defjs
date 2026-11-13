import type { Attributes } from "@opentelemetry/api";
import { createResolvedRequestUrl } from "@defjs/core";

export interface ResolvedUrl {
  url: string;
  serverAddress?: string;
  serverPort?: number;
}

// OpenTelemetry semantic conventions: `url.full` must not carry credentials, so userinfo is replaced
// with this placeholder instead of being dropped (`https://REDACTED:REDACTED@host/`). The same
// document says the values of these query keys should be redacted by default, matched
// case-sensitively and with the key kept (`?sig=REDACTED`).
const REDACTED = "REDACTED";
const SENSITIVE_QUERY_KEYS: ReadonlySet<string> = new Set([
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token",
  "AWSAccessKeyId",
  "Signature",
  "sig",
  "X-Goog-Signature",
]);
const AUTHORITY_USERINFO = /^((?:[A-Za-z][A-Za-z0-9+.-]*:)?[/\\]{2})[^/\\?#]+@/;

function redactQuery(query: string): string {
  return query
    .split("&")
    .map((param) => {
      const separator = param.indexOf("=");
      const rawKey = separator < 0 ? param : param.slice(0, separator);
      // Match the decoded key, so a percent-encoded `%73ig` is still `sig`.
      const key = new URLSearchParams(rawKey).keys().next().value ?? "";
      return SENSITIVE_QUERY_KEYS.has(key) ? `${rawKey}=${REDACTED}` : param;
    })
    .join("&");
}

function redactUrl(url: URL): URL {
  if (url.username || url.password) {
    url.username = REDACTED;
    url.password = REDACTED;
  }
  const query = url.search.slice(1);
  const redacted = redactQuery(query);
  if (redacted !== query) {
    url.search = redacted;
  }
  return url;
}

// A string that is not an absolute URL cannot be parsed, so userinfo in its authority and the
// values of sensitive query keys are replaced textually and everything else keeps its spelling.
function redactEndpointText(endpoint: string): string {
  const text = endpoint.replace(
    AUTHORITY_USERINFO,
    `$1${REDACTED}:${REDACTED}@`,
  );
  const queryStart = text.indexOf("?");
  const fragmentStart = text.indexOf("#");
  if (queryStart < 0 || (fragmentStart >= 0 && fragmentStart < queryStart)) {
    return text;
  }
  const queryEnd = fragmentStart < 0 ? text.length : fragmentStart;
  return `${text.slice(0, queryStart + 1)}${redactQuery(
    text.slice(queryStart + 1, queryEnd),
  )}${text.slice(queryEnd)}`;
}

// A fallback endpoint is returned as written unless redaction changes it, so a credential-free
// absolute URL keeps its original spelling instead of the parser's normalised form.
export function redactEndpoint(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    const before = parsed.href;
    redactUrl(parsed);
    return parsed.href === before ? endpoint : parsed.href;
  } catch {
    return redactEndpointText(endpoint);
  }
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  "http:": 80,
  "https:": 443,
  "ws:": 80,
  "wss:": 443,
};

export function resolveHttpUrl(
  endpoint: string,
  baseEndpoint?: string,
): ResolvedUrl {
  return resolveUrl(endpoint, baseEndpoint, (parsed) => parsed);
}

export function resolveWebSocketUrl(
  endpoint: string,
  baseEndpoint?: string,
): ResolvedUrl {
  return resolveUrl(endpoint, baseEndpoint, (parsed) => {
    if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    } else if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    }
    return parsed;
  });
}

export function serverAttributes({
  serverAddress,
  serverPort,
}: Omit<ResolvedUrl, "url">): Attributes {
  const attributes: Attributes = {};
  if (serverAddress) attributes["server.address"] = serverAddress;
  if (serverPort) attributes["server.port"] = serverPort;
  return attributes;
}

function resolveUrl(
  endpoint: string,
  baseEndpoint: string | undefined,
  finalize: (parsed: URL) => URL,
): ResolvedUrl {
  if (!baseEndpoint) {
    return { url: redactEndpoint(endpoint) };
  }
  try {
    const parsed = finalize(createResolvedRequestUrl(baseEndpoint, endpoint));
    return {
      url: redactUrl(parsed).toString(),
      serverAddress: parsed.hostname,
      serverPort: parsed.port
        ? Number.parseInt(parsed.port, 10)
        : DEFAULT_PORTS[parsed.protocol],
    };
  } catch {
    return { url: redactEndpoint(endpoint) };
  }
}
