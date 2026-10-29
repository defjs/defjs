import { createServer, type Server } from "node:http";
import type { createAdaptorServer } from "@hono/node-server";
import { expect, inject, onTestFinished, test, vi } from "vitest";
import type { TestProject } from "vitest/node";
import { setup, teardown } from "../setup";

const adaptor = vi.hoisted(() => ({ servers: [] as Server[] }));

// Records the real server that `setup` creates while still delegating to the original adapter.
vi.mock("@hono/node-server", async (importOriginal) => {
  const original = await importOriginal<{
    createAdaptorServer: typeof createAdaptorServer;
  }>();
  return {
    ...original,
    createAdaptorServer(options: Parameters<typeof createAdaptorServer>[0]) {
      const server = original.createAdaptorServer(options);
      adaptor.servers.push(server as Server);
      return server;
    },
  };
});

type SetupServer = {
  host: string;
  port: number;
  provide: ReturnType<typeof vi.fn>;
  server: Server;
};

const ownedServers: Server[] = [];
const ownedSockets: WebSocket[] = [];

// The module under test lives in this worker, so its state cannot reach the real globalSetup process.
async function withSetupServer(
  run: (setupServer: SetupServer) => Promise<void>,
): Promise<void> {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const provide = vi.fn();
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    // A timed-out test can settle later; its finally must not clean up the next test.
    cleanupPromise ??= (async () => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      for (const socket of ownedSockets) {
        socket.close();
      }
      await teardown().catch(() => undefined);
      await Promise.all([...ownedServers, ...adaptor.servers].map(closeServer));
      ownedSockets.length = 0;
      ownedServers.length = 0;
      adaptor.servers.length = 0;
    })();
    return cleanupPromise;
  };
  onTestFinished(cleanup);

  try {
    await setup({ provide } as unknown as TestProject);
    if (cleanupPromise) {
      return;
    }
    const [server] = adaptor.servers;
    if (adaptor.servers.length !== 1 || !server) {
      throw new Error("Expected setup to create exactly one adapter server");
    }
    const port = portOf(server);
    await run({ host: `http://127.0.0.1:${port}`, port, provide, server });
  } finally {
    await cleanup();
  }
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TypeError("Expected a TCP server address");
  }
  return address.port;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  // A server that stopped listening may still be closing existing connections.
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function createReplacementServer(): Server {
  const server = createServer((_request, response) => {
    response.end("replacement");
  });
  ownedServers.push(server);
  return server;
}

async function readText(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}

async function failedTeardown(): Promise<AggregateError | undefined> {
  try {
    await teardown();
    return undefined;
  } catch (error) {
    if (error instanceof AggregateError) {
      return error;
    }
    throw error;
  }
}

function messages(failure: AggregateError | undefined): string[] {
  return (failure?.errors ?? []).map((error: Error) => error.message);
}

test("teardown does not mistake a replacement server on the released port for its own listener", async () => {
  await withSetupServer(async ({ host, port, provide, server }) => {
    expect(provide).toHaveBeenCalledTimes(1);
    expect(provide).toHaveBeenCalledWith("testServerHost", host);
    expect(host).not.toBe(inject("testServerHost"));

    const socket = new WebSocket(`${host.replace("http:", "ws:")}/ws/echo`);
    ownedSockets.push(socket);
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("WebSocket failed to open")),
        { once: true },
      );
    });
    const closedSocket = new Promise<void>((resolve) =>
      socket.addEventListener("close", () => resolve(), { once: true }),
    );
    await opened;

    const replacement = createReplacementServer();
    const events: string[] = [];
    server.once("close", () => events.push("server close event"));
    const originalClose = server.close.bind(server);
    const close = vi.spyOn(server, "close").mockImplementation((callback) => {
      originalClose((error) => {
        events.push("original close callback");
        // The listening socket is already released: another real server takes the exact port before teardown hears the success.
        listen(replacement, port).then(
          () => {
            events.push("replacement listening");
            callback?.(error);
          },
          (listenError: Error) => callback?.(listenError),
        );
      });
      return server;
    });

    expect(messages(await failedTeardown())).toEqual([]);

    expect(events).toEqual([
      "server close event",
      "original close callback",
      "replacement listening",
    ]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
    expect(server.address()).toBeNull();
    await closedSocket;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(replacement.listening).toBe(true);
    expect(portOf(replacement)).toBe(port);
    expect(await readText(host)).toBe("replacement");

    expect(messages(await failedTeardown())).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(replacement.listening).toBe(true);
    expect(await readText(host)).toBe("replacement");
    expect((await fetch(inject("testServerHost"))).status).toBe(200);
  });
});

test("teardown reports a failed HTTP server close with its labeled original cause and can be repeated", async () => {
  await withSetupServer(async ({ server }) => {
    const injected = new Error("injected close failure");
    const originalClose = server.close.bind(server);
    const close = vi.spyOn(server, "close").mockImplementation((callback) => {
      originalClose(() => callback?.(injected));
      return server;
    });

    const failure = await failedTeardown();

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure?.message).toBe("Test server teardown failed");
    expect(messages(failure)).toEqual([
      "HTTP server close failed: injected close failure",
    ]);
    expect(failure?.errors[0].cause).toBe(injected);
    expect(server.listening).toBe(false);

    expect(await failedTeardown()).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

test("teardown reports an HTTP server close that never completes as a labeled timeout", async () => {
  await withSetupServer(async ({ server }) => {
    let closeRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      closeRequested = resolve;
    });
    const originalClose = server.close.bind(server);
    vi.spyOn(server, "close").mockImplementation(() => {
      closeRequested();
      originalClose(() => undefined);
      return server;
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = failedTeardown();
    await requested;
    await vi.runOnlyPendingTimersAsync();
    const failure = await pending;

    expect(failure?.message).toBe("Test server teardown failed");
    expect(messages(failure)).toEqual([
      "HTTP server close failed: HTTP server close timed out",
    ]);
    expect(failure?.errors[0].cause).toMatchObject({
      message: "HTTP server close timed out",
    });

    vi.useRealTimers();
    expect(await failedTeardown()).toBeUndefined();
  });
});
