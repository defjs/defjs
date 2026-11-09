import { upgradeWebSocket, websocket } from "@hono/bun";
import type { Socket } from "bun";
import { readRawHead } from "./raw-scenarios.ts";
import {
  fetchClosingConnection,
  type HttpApp,
  type StartedServer,
  type StartupLayer,
} from "./startup.ts";
import type { RawConnection, RawHandler, RawReply } from "./types.ts";

interface RawSocketData {
  received: string;
  handled: boolean;
  finished: boolean;
  readonly closed: Promise<void>;
  resolveClosed: () => void;
}

export function createBunStartup(): Promise<StartupLayer> {
  return Promise.resolve({
    runtime: "bun",
    upgradeWebSocket,
    startHttp,
    startRaw,
    reserveRefusedOrigin,
  });
}

function startHttp(app: HttpApp): Promise<StartedServer> {
  const server = Bun.serve({
    fetch: fetchClosingConnection(app),
    hostname: "127.0.0.1",
    port: 0,
    websocket,
  });
  server.unref();
  let closed = false;
  return Promise.resolve({
    origin: `http://127.0.0.1:${server.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await server.stop(true);
    },
  });
}

function startRaw(handler: RawHandler): Promise<StartedServer> {
  const sockets = new Set<Socket<RawSocketData>>();
  const listener = Bun.listen<RawSocketData>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = createRawSocketData();
        sockets.add(socket);
      },
      close(socket) {
        sockets.delete(socket);
        socket.data.resolveClosed();
      },
      error(socket) {
        const state = socket.data;
        if (state.finished) return;
        state.finished = true;
        socket.terminate();
      },
      data(socket, chunk) {
        const state = socket.data;
        if (state.handled) return;
        state.received += latin1(chunk);
        const parsed = readRawHead(state.received);
        if (parsed === undefined) return;
        state.handled = true;
        const connection = bunConnection(socket, state);
        let reply: RawReply | undefined;
        try {
          reply = handler({ ...parsed, connection });
        } catch (error) {
          console.error("Raw fixture handler failed", error);
          void connection.terminate();
          return;
        }
        applyReply(socket, state, connection, reply);
      },
    },
  });
  listener.unref();
  let closed = false;
  return Promise.resolve({
    origin: `http://127.0.0.1:${listener.port}`,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      for (const socket of [...sockets]) {
        const state = socket.data;
        if (!state.finished) {
          state.finished = true;
          socket.terminate();
        }
      }
      listener.stop(true);
      return Promise.resolve();
    },
  });
}

function reserveRefusedOrigin(): Promise<string> {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {
        return undefined;
      },
    },
  });
  const origin = `http://127.0.0.1:${listener.port}`;
  listener.stop(true);
  return Promise.resolve(origin);
}

function applyReply(
  socket: Socket<RawSocketData>,
  state: RawSocketData,
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
  connection.write(reply.bytes);
  if (reply.then === "terminate") {
    void connection.terminate();
  }
}

function bunConnection(
  socket: Socket<RawSocketData>,
  state: RawSocketData,
): RawConnection {
  return {
    write(bytes) {
      writeAll(socket, bytes);
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
        socket.flush();
        socket.terminate();
      }
      return state.closed;
    },
  };
}

function writeAll(socket: Socket<RawSocketData>, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = socket.write(bytes, offset);
    if (written <= 0) return;
    offset += written;
  }
}

function latin1(chunk: Uint8Array): string {
  let text = "";
  for (const byte of chunk) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function createRawSocketData(): RawSocketData {
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  return {
    received: "",
    handled: false,
    finished: false,
    closed,
    resolveClosed,
  };
}
