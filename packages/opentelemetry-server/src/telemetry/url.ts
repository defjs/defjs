import type { Attributes } from "@opentelemetry/api";
import { createResolvedRequestUrl } from "@defjs/core";

export interface ResolvedUrl {
  url: string;
  serverAddress?: string;
  serverPort?: number;
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
  return {
    ...(serverAddress ? { "server.address": serverAddress } : {}),
    ...(serverPort ? { "server.port": serverPort } : {}),
  };
}

function resolveUrl(
  endpoint: string,
  baseEndpoint: string | undefined,
  finalize: (parsed: URL) => URL,
): ResolvedUrl {
  if (!baseEndpoint) {
    return { url: endpoint };
  }
  try {
    const parsed = finalize(createResolvedRequestUrl(baseEndpoint, endpoint));
    return {
      url: parsed.toString(),
      serverAddress: parsed.hostname,
      serverPort: parsed.port
        ? Number.parseInt(parsed.port, 10)
        : DEFAULT_PORTS[parsed.protocol],
    };
  } catch {
    return { url: endpoint };
  }
}
