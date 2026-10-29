import type { ServerResponse } from "node:http";
import type { Hono } from "hono";
import { stream } from "hono/streaming";

type StallState = { closed: number; opened: number };

/** Resolves after `ms`, or as soon as `signal` aborts. The timer never keeps the server process alive. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function isClientUploadAbort(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("code" in error && error.code === "ECONNRESET") {
    return true;
  }
  return (
    error.message === "aborted" ||
    error.message === "Client connection prematurely closed."
  );
}

/** Response bodies for the platform-fetch read paths: several chunks, empty, stalled mid-flight, cut short. */
export function registerBodyRoutes(app: Hono): void {
  const stalls = new Map<string, StallState>();
  const stallOf = (key: string): StallState => {
    const existing = stalls.get(key);
    if (existing) {
      return existing;
    }
    const created = { closed: 0, opened: 0 };
    stalls.set(key, created);
    return created;
  };
  const large = JSON.stringify(
    Array.from({ length: 6000 }, (_, id) => ({ id, name: `item-${id}` })),
  );

  app.get("/body/large", (c) =>
    c.body(large, 200, { "content-type": "application/json" }),
  );
  // A present body with zero bytes, as opposed to no body at all.
  app.get("/body/empty", (c) =>
    c.body("", 200, { "content-type": "application/json" }),
  );
  app.get("/body/no-content", (c) => c.body(null, 204));

  // Sends the first bytes of a body, then holds the response open until the client hangs up. `opened` counts responses whose
  // first bytes are out, so a client that saw it change is reading the body rather than still waiting for headers.
  app.get("/body/stall", (c) => {
    const state = stallOf(c.req.query("key") ?? "default");
    c.header("content-type", "application/json");
    return stream(c, async (body) => {
      const hungUp = new Promise<void>((resolve) => {
        body.onAbort(resolve);
        c.req.raw.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      await body.write('{"partial":');
      state.opened += 1;
      await Promise.race([hungUp, pause(10_000, c.req.raw.signal)]);
      if (body.aborted || c.req.raw.signal.aborted) {
        state.closed += 1;
      }
    });
  });
  app.get("/body/stall-state", (c) =>
    c.json(stallOf(c.req.query("key") ?? "default")),
  );

  // Upload tests abort the body while it is being read. Hono's default error handler would print that
  // ECONNRESET; a client abort is the case under test, and any other read failure still propagates.
  app.post("/body/upload", async (c) => {
    try {
      await c.req.arrayBuffer();
    } catch (error) {
      if (!isClientUploadAbort(error)) {
        throw error;
      }
    }
    return c.body(null, 204);
  });

  // Drops the socket after the first chunk: no terminating chunk, so the client sees a transport failure.
  app.get("/body/truncated", (c) => {
    const { outgoing } = c.env as unknown as { outgoing: ServerResponse };
    c.header("content-type", "application/json");
    return stream(c, async (body) => {
      await body.write('{"partial":');
      await body.sleep(30);
      outgoing.destroy();
    });
  });
}
