import { expect, test, vi } from "vitest";
import type { Balancer, DoneInfo } from "../balancer";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withInterceptors,
  withSSEHandle,
  withRetry,
} from "../client";
import { createSSEInterceptor } from "../interceptor";
import { struct } from "../struct";
import { defineEventStream } from "./index";

const orders = defineEventStream({
  events: { message: struct.string() },
  operation: "orders",
  path: "/events",
});

const CREDENTIAL_URLS = [
  "https://user:secret@example.com",
  "https://user@example.com",
  "https://:secret@example.com",
];

function sseResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

function droppedAfterEventResponse(): Response {
  const encoder = new TextEncoder();
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new TypeError("connection lost"));
          return;
        }
        sent = true;
        controller.enqueue(encoder.encode("data: hi\n\n"));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function pickSequence(endpoints: readonly string[]): {
  balancer: Balancer;
  dones: DoneInfo[];
} {
  const dones: DoneInfo[] = [];
  let index = 0;
  return {
    dones,
    balancer: {
      pick() {
        const endpoint = endpoints[Math.min(index, endpoints.length - 1)];
        index += 1;
        if (endpoint === undefined) {
          throw new Error("no endpoint");
        }
        return [
          null,
          {
            endpoint,
            done(info) {
              dones.push(info);
            },
          },
        ];
      },
    },
  };
}

function expectCredentialsRefused(error: {
  code: string;
  cause?: unknown;
}): void {
  expect(error.code).toBe("REQ_BUILD_FAILED");
  expect(error.cause).toBeInstanceOf(TypeError);
  if (!(error.cause instanceof TypeError)) {
    throw new Error("expected a TypeError cause");
  }
  expect(error.cause.message).toBe("The URL must not include credentials");
}

test.each(CREDENTIAL_URLS)(
  "refuses the first attempt to %s as a build failure before any request",
  async (url) => {
    const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
    const { balancer, dones } = pickSequence([url]);
    const [error, stream] = await orders(
      createClient(
        withEndpoint(url),
        withBalancer(balancer),
        withSSEHandle(handle),
      ),
    );
    expect(stream).toBeUndefined();
    if (error === null) {
      throw new Error("expected a fault");
    }
    expectCredentialsRefused(error);
    expect(handle).not.toHaveBeenCalled();
    expect(dones).toEqual([{ attempted: false }]);
  },
);

test("refuses a URL with credentials that an interceptor wrote into the request", async () => {
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const [error] = await orders(
    createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor((request, next) => {
          request.baseEndpoint = "https://user:secret@example.com";
          return next(request);
        }),
      ),
    ),
  );
  if (error === null) {
    throw new Error("expected a fault");
  }
  expectCredentialsRefused(error);
  expect(handle).not.toHaveBeenCalled();
});

test("does not put the credentials into the fault", async () => {
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const [error] = await orders(
    createClient(
      withEndpoint("https://user:secret@example.com"),
      withSSEHandle(handle),
    ),
  );
  if (error === null) {
    throw new Error("expected a fault");
  }
  expectCredentialsRefused(error);
  expect(String(error.cause)).not.toMatch(/secret|example\.com/);
});

test("accepts a URL without credentials", async () => {
  const handle = vi.fn(() => Promise.resolve(sseResponse("data: hi\n\n")));
  const [error, stream] = await orders(
    createClient(
      withEndpoint("https://example.com:8443"),
      withSSEHandle(handle),
    ),
  );
  expect(error).toBeNull();
  expect(handle).toHaveBeenCalledOnce();
  await stream?.closed;
});

test.each(CREDENTIAL_URLS)(
  "refuses a reconnect that re-picks %s before open",
  async (url) => {
    const handle = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const { balancer, dones } = pickSequence(["https://example.com", url]);
    const [error, stream] = await orders(
      createClient(
        withEndpoint("https://example.com", url),
        withBalancer(balancer),
        withSSEHandle(handle),
        withRetry({ maxRetries: 1, delayMs: 0, factor: 1 }),
      ),
    );
    expect(stream).toBeUndefined();
    if (error === null) {
      throw new Error("expected a fault");
    }
    expect(error.code).toBe("REQ_BUILD_FAILED");
    expect(handle).toHaveBeenCalledOnce();
    expect(dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: false },
    ]);
  },
);

test("closes with a build failure when a reconnect after open re-picks a URL with credentials", async () => {
  // Only the first call may succeed: a second one means the reconnect was not refused.
  let calls = 0;
  const handle = vi.fn(() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(droppedAfterEventResponse())
      : Promise.reject(new TypeError("fetch failed"));
  });
  const { balancer, dones } = pickSequence([
    "https://example.com",
    "https://user:secret@example.com",
  ]);
  const [error, stream] = await orders(
    createClient(
      withEndpoint("https://example.com", "https://user:secret@example.com"),
      withBalancer(balancer),
      withSSEHandle(handle),
      withRetry({ maxRetries: 1, delayMs: 0, factor: 1 }),
    ),
  );
  expect(error).toBeNull();
  const closed = await stream?.closed;
  if (closed?.kind !== "error") {
    throw new Error("expected the reconnect to close as an error");
  }
  expect(closed.code).toBe("REQ_BUILD_FAILED");
  expect(closed.cause).toMatchObject({ code: "REQ_BUILD_FAILED" });
  expect(handle).toHaveBeenCalledOnce();
  expect(dones).toEqual([
    { attempted: true, code: "NET_UNREACHABLE" },
    { attempted: false },
  ]);
});
