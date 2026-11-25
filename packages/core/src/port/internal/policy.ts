import type { PortHostOptions, PortRequestCheckContext } from "../types";

interface OriginRule {
  readonly protocol: "http:" | "https:" | "ws:" | "wss:";
  readonly host: string;
}

export type PolicyResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string };

export interface RequestPolicy {
  readonly check: (
    transport: "http" | "websocket",
    rawUrl: string,
    method: string,
    headers: Headers,
  ) => Promise<PolicyResult>;
}

function parseRuleProtocol(
  protocol: string,
): OriginRule["protocol"] | undefined {
  if (
    protocol === "http:" ||
    protocol === "https:" ||
    protocol === "ws:" ||
    protocol === "wss:"
  ) {
    return protocol;
  }
  return undefined;
}

function parseOriginRule(origin: string): OriginRule {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new RangeError(`Invalid allowedOrigins entry: "${origin}"`);
  }
  const protocol = parseRuleProtocol(parsed.protocol);
  if (protocol === undefined) {
    throw new RangeError(
      `Unsupported scheme in allowedOrigins entry: "${origin}"`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new RangeError(
      `allowedOrigins entry must not contain credentials: "${origin}"`,
    );
  }
  return { protocol, host: parsed.host };
}

function allowsProtocol(
  ruleProtocol: OriginRule["protocol"],
  targetProtocol: string,
): boolean {
  switch (ruleProtocol) {
    case "http:":
      return targetProtocol === "http:" || targetProtocol === "ws:";
    case "https:":
      return targetProtocol === "https:" || targetProtocol === "wss:";
    default:
      return ruleProtocol === targetProtocol;
  }
}

function isTargetSchemeAllowed(
  transport: "http" | "websocket",
  protocol: string,
): boolean {
  return transport === "http"
    ? protocol === "http:" || protocol === "https:"
    : protocol === "ws:" || protocol === "wss:";
}

export function createRequestPolicy(options: PortHostOptions): RequestPolicy {
  const hasAllowedOrigins =
    options.allowedOrigins !== undefined && options.allowedOrigins.length > 0;
  const hasAllowRequest = options.allowRequest !== undefined;
  const allowAnyOrigin = options.allowAnyOrigin === true;

  if (!hasAllowedOrigins && !hasAllowRequest && !allowAnyOrigin) {
    throw new RangeError(
      "attachPortHost requires allowedOrigins, allowRequest, or allowAnyOrigin: true",
    );
  }

  const rules = options.allowedOrigins?.map(parseOriginRule);
  const { allowRequest } = options;

  return {
    async check(transport, rawUrl, method, headers): Promise<PolicyResult> {
      let target: URL;
      try {
        target = new URL(rawUrl);
      } catch {
        return { ok: false, reason: "Invalid target URL" };
      }

      if (target.username !== "" || target.password !== "") {
        return { ok: false, reason: "URLs with credentials are not allowed" };
      }

      if (!isTargetSchemeAllowed(transport, target.protocol)) {
        return {
          ok: false,
          reason: `Disallowed URL scheme "${target.protocol}" for ${transport}`,
        };
      }

      if (rules !== undefined && rules.length > 0) {
        const matched = rules.some(
          (rule) =>
            rule.host === target.host &&
            allowsProtocol(rule.protocol, target.protocol),
        );
        if (!matched) {
          return {
            ok: false,
            reason: `Origin "${target.origin}" is not allowed`,
          };
        }
      }

      if (allowRequest !== undefined) {
        const context: PortRequestCheckContext = {
          transport,
          url: target,
          method,
          headers,
        };
        try {
          const allowed = await allowRequest(context);
          if (!allowed) {
            return { ok: false, reason: "Request denied by policy" };
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            reason: message || "Request denied by policy",
          };
        }
      }

      return { ok: true, url: target };
    },
  };
}
