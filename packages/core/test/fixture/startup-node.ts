import { serve, upgradeWebSocket } from "@hono/node-server";
import { Server as HttpServer } from "node:http";
import { createServer, type Socket } from "node:net";
import { WebSocketServer } from "ws";
import { readRawHead } from "./raw-scenarios.ts";
import {
  fetchClosingConnection,
  type HttpApp,
  type StartedServer,
  type StartupLayer,
} from "./startup.ts";
import type { RawConnection, RawHandler, RawReply } from "./types.ts";

interface RawSocketState {
  handled: boolean;
  finished: boolean;
  readonly closed: Promise<void>;
  resolveClosed: () => void;
}

export function createNodeStartup(): Promise<StartupLayer> {
  return Promise.resolve({
    runtime: "node",
    upgradeWebSocket,
    startHttp,
    startRaw,
    reserveRefusedOrigin,
  });
}

function startHttp(app: HttpApp): Promise<StartedServer> {
  const wss = new WebSocketServer({ noServer: true });
  const server = serve({
    fetch: nodeFetch(app),
    hostname: "127.0.0.1",
    port: 0,
    overrideGlobalObjects: false,
    websocket: { server: wss },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    server.once("error", (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        cause instanceof Error
          ? cause
          : new Error("HTTP server failed to start"),
      );
    });
    server.once("listening", () => {
      if (settled) return;
      settled = true;
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("HTTP server did not bind a TCP port"));
        return;
      }
      server.unref();
      let closed = false;
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        async close() {
          if (closed) return;
          closed = true;
          await closeHttp(server, wss);
        },
      });
    });
  });
}

function nodeFetch(app: HttpApp): HttpApp["fetch"] {
  const fetch = fetchClosingConnection(app);
  return (request, ...rest) => {
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return fetch(request, ...rest);
    }
    return Promise.resolve(fetch(request, ...rest)).then(chunkedStreamResponse);
  };
}

// @hono/node-server pre-reads a body unless it is already chunked, and a
// stream error in that window becomes a finished content-length response.
function chunkedStreamResponse(response: Response): Response {
  if (response.body === null || response.headers.has("content-length")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("transfer-encoding", "chunked");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function closeHttp(
  server: ReturnType<typeof serve>,
  wss: WebSocketServer,
): Promise<void> {
  for (const client of [...wss.clients]) {
    client.terminate();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    if (server instanceof HttpServer) {
      server.closeAllConnections();
    }
  });
  wss.close();
}

function startRaw(handler: RawHandler): Promise<StartedServer> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    socket.setNoDelay(true);
    sockets.add(socket);
    const state = createRawSocketState();
    let received = "";
    socket.on("error", () => {
      socket.destroy();
    });
    socket.on("close", () => {
      sockets.delete(socket);
      state.resolveClosed();
    });
    socket.on("data", (chunk) => {
      if (state.handled) return;
      received += chunk.toString("latin1");
      const parsed = readRawHead(received);
      if (parsed === undefined) return;
      state.handled = true;
      const connection = nodeConnection(socket, state);
      let reply: RawReply | undefined;
      try {
        reply = handler({ ...parsed, connection });
      } catch (error) {
        console.error("Raw fixture handler failed", error);
        void connection.terminate();
        return;
      }
      applyReply(socket, state, connection, reply);
    });
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    server.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      if (settled) return;
      settled = true;
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Raw server did not bind a TCP port"));
        return;
      }
      server.unref();
      let closed = false;
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        async close() {
          if (closed) return;
          closed = true;
          for (const open of [...sockets]) {
            open.destroy();
          }
          if (!server.listening) return;
          await new Promise<void>((done, fail) => {
            server.close((error) => {
              if (error) fail(error);
              else done();
            });
          });
        },
      });
    });
  });
}

async function reserveRefusedOrigin(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Refused origin did not bind a TCP port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return origin;
}

function applyReply(
  socket: Socket,
  state: RawSocketState,
  connection: RawConnection,
  reply: RawReply | undefined,
): void {
  if (reply === undefined) {
    void connection.terminate();
    return;
  }
  if (reply.then === "end") {
    if (!state.finished) {
      state.finished = true;
      socket.end(reply.bytes);
    }
    return;
  }
  if (reply.then === "terminate") {
    if (state.finished) return;
    state.finished = true;
    socket.write(reply.bytes, () => {
      socket.destroy();
    });
    return;
  }
  socket.write(reply.bytes);
}

function nodeConnection(socket: Socket, state: RawSocketState): RawConnection {
  return {
    write(bytes) {
      socket.write(bytes);
    },
    end() {
      if (!state.finished) {
        state.finished = true;
        socket.end();
      }
      return state.closed;
    },
    terminate() {
      if (!state.finished) {
        state.finished = true;
        socket.destroy();
      }
      return state.closed;
    },
  };
}

function createRawSocketState(): RawSocketState {
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  return {
    handled: false,
    finished: false,
    closed,
    resolveClosed,
  };
}
