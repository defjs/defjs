import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { RawHandler } from "./types.ts";

// Structural so a second copy of hono under npm still typechecks.
export type HttpApp = Pick<Hono, "fetch">;

function isWebSocketUpgrade(header: string | null): boolean {
  return header !== null && header.toLowerCase() === "websocket";
}

// Bun retries an idempotent request when a reused connection dies mid-body.
// Closing every finished response keeps one client call to one server hit.
// Headers are copied because a redirect or network-error response freezes them.
export function fetchClosingConnection(app: HttpApp): HttpApp["fetch"] {
  const fetch = app.fetch.bind(app);
  return (request, ...rest) => {
    if (isWebSocketUpgrade(request.headers.get("upgrade"))) {
      return fetch(request, ...rest);
    }
    return Promise.resolve(fetch(request, ...rest)).then((response) => {
      const headers = new Headers(response.headers);
      headers.set("connection", "close");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  };
}

export interface StartedServer {
  origin: string;
  close(): Promise<void>;
}

export interface StartupLayer {
  readonly runtime: "bun" | "node";
  readonly upgradeWebSocket: UpgradeWebSocket;
  startHttp(app: HttpApp): Promise<StartedServer>;
  startRaw(handler: RawHandler): Promise<StartedServer>;
  reserveRefusedOrigin(): Promise<string>;
}

export async function selectStartup(): Promise<StartupLayer> {
  if (process.versions.bun === undefined) {
    const { createNodeStartup } = await import("./startup-node.ts");
    return createNodeStartup();
  }
  const { createBunStartup } = await import("./startup-bun.ts");
  return createBunStartup();
}
