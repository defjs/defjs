import { Hono } from "hono";
import type { Plugin } from "vite";
import { registerXsrfRoutes } from "./xsrf-middleware.ts";

/** The subset of Vite's Connect request object this proxy reads. */
type RequestLike = {
  headers: { [key: string]: string | string[] | undefined };
  method?: string | undefined;
  url?: string | undefined;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
};

/** The subset of Vite's Connect response object this proxy writes. */
type ResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: Uint8Array): void;
};

function concat(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function toRequest(req: RequestLike, body: Uint8Array<ArrayBuffer>): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const hostHeader = req.headers["host"] ?? "localhost";
  const host = Array.isArray(hostHeader) ? hostHeader.join(",") : hostHeader;
  return new Request(`http://${host}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: body.byteLength > 0 ? body : undefined,
  });
}

async function sendResponse(
  response: Response,
  res: ResponseLike,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(new Uint8Array(await response.arrayBuffer()));
}

async function forward(
  req: RequestLike,
  res: ResponseLike,
  app: Hono,
): Promise<void> {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
  }
  const response = await app.fetch(toRequest(req, concat(chunks)));
  await sendResponse(response, res);
}

export function xsrfProxyPlugin(): Plugin {
  const app = new Hono();
  registerXsrfRoutes(app);

  return {
    name: "xsrf-test-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/xsrf-")) {
          next();
          return;
        }
        forward(req, res, app).catch(next);
      });
    },
  };
}
