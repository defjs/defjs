import type { Socket } from "bun";

/**
 * Serves one chunked body without its terminating chunk. A JS ReadableStream error is
 * surfaced differently by each fetch path in Firefox; a real socket truncation is not.
 */
export function startTruncatedServer(): {
  url: string;
  close(): void;
} {
  const sockets = new Set<Socket>();
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        sockets.add(socket);
      },
      close(socket) {
        sockets.delete(socket);
      },
      data(socket) {
        const body = '{"partial":';
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "access-control-allow-origin: *\r\n" +
            "content-type: application/json\r\n" +
            "transfer-encoding: chunked\r\n" +
            "connection: close\r\n\r\n" +
            `${body.length.toString(16)}\r\n${body}\r\n`,
        );
        socket.end();
      },
    },
  });
  return {
    url: `http://127.0.0.1:${listener.port}`,
    close() {
      for (const socket of sockets) socket.terminate();
      listener.stop(true);
    },
  };
}
