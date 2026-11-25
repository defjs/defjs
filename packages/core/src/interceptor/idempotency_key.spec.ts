import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
} from "../client";
import { defineRequest } from "../http";
import type { HttpRequest } from "../http";
import { makeFakeHandler } from "../../test/make_fake_handler";
import { struct } from "../struct";
import { idempotencyKeyHttpInterceptor } from "./idempotency_key";
import { makeChain } from "./interceptor";

describe("idempotencyKeyHttpInterceptor", () => {
  test("attaches Idempotency-Key for default POST/PATCH (case-insensitive) and skips safe/non-matching methods", async () => {
    const interceptor = idempotencyKeyHttpInterceptor();
    const chain = makeChain([interceptor.fn]);
    const forwarded: HttpRequest[] = [];
    const handler = makeFakeHandler({
      response: { status: 200 },
      onRequestBefore: (req) => {
        forwarded.push(req);
      },
    });

    for (const method of ["POST", "patch", "GET", "PUT", "DELETE", "HEAD"]) {
      await chain(
        {
          baseEndpoint: "https://example.test",
          endpoint: "/orders",
          method,
        },
        handler,
      );
    }

    expect(forwarded[0]?.headers?.get("Idempotency-Key")).toMatch(/.+/);
    expect(forwarded[1]?.headers?.get("Idempotency-Key")).toMatch(/.+/);
    expect(forwarded[0]?.headers?.get("Idempotency-Key")).not.toBe(
      forwarded[1]?.headers?.get("Idempotency-Key"),
    );
    for (const index of [2, 3, 4, 5]) {
      expect(forwarded[index]?.headers).toBeUndefined();
    }
  });

  test("clones Headers immutably, respects custom headerName/methods, and snapshots methods array", async () => {
    const methods = ["put"];
    const interceptor = idempotencyKeyHttpInterceptor({
      headerName: "X-Idempotency",
      methods,
      generate: () => "fixed-key",
    });
    methods.push("DELETE");

    const chain = makeChain([interceptor.fn]);
    const originalHeaders = new Headers({ "x-trace": "1" });
    const incoming: HttpRequest = {
      baseEndpoint: "https://example.test",
      endpoint: "/orders",
      headers: originalHeaders,
      method: "PUT",
    };

    const seen: HttpRequest[] = [];
    await chain(
      incoming,
      makeFakeHandler({
        response: { status: 200 },
        onRequestBefore: (req) => seen.push(req),
      }),
    );

    expect(seen[0]?.headers).not.toBe(originalHeaders);
    expect(seen[0]?.headers?.get("X-Idempotency")).toBe("fixed-key");
    expect(seen[0]?.headers?.get("x-trace")).toBe("1");
    expect(originalHeaders.has("X-Idempotency")).toBe(false);

    // Mutating caller `methods` after factory creation had no effect.
    await chain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        method: "DELETE",
      },
      makeFakeHandler({
        response: { status: 200 },
        onRequestBefore: (req) => seen.push(req),
      }),
    );
    expect(seen[1]?.headers?.has("X-Idempotency")).toBeUndefined();
  });

  test("respectExisting preserves caller header without invoking generate unless set to false", async () => {
    const genKeep = vi.fn(() => "generated-1");
    const keepInterceptor = idempotencyKeyHttpInterceptor({
      generate: genKeep,
    });
    const keepChain = makeChain([keepInterceptor.fn]);

    const seen: HttpRequest[] = [];
    const handler = makeFakeHandler({
      response: { status: 200 },
      onRequestBefore: (req) => seen.push(req),
    });

    const existingHeaders = new Headers({ "Idempotency-Key": "caller-key" });
    await keepChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        headers: existingHeaders,
        method: "POST",
      },
      handler,
    );
    await keepChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        headers: new Headers({ "x-other": "ok" }),
        method: "POST",
      },
      handler,
    );

    expect(seen[0]?.headers).toBe(existingHeaders);
    expect(seen[0]?.headers?.get("Idempotency-Key")).toBe("caller-key");
    expect(seen[1]?.headers?.get("Idempotency-Key")).toBe("generated-1");
    expect(genKeep).toHaveBeenCalledTimes(1);

    const overwriteChain = makeChain([
      idempotencyKeyHttpInterceptor({
        generate: () => "overwritten-key",
        respectExisting: false,
      }).fn,
    ]);
    await overwriteChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        headers: existingHeaders,
        method: "POST",
      },
      handler,
    );
    expect(seen[2]?.headers?.get("Idempotency-Key")).toBe("overwritten-key");
    expect(existingHeaders.get("Idempotency-Key")).toBe("caller-key");
  });

  test("reuses req.correlationId across retries and supports separate logical calls", async () => {
    const createOrder = defineRequest({
      method: "POST",
      path: "/orders",
      input: struct.object({ item: struct.string() }),
      builder: ({ item }) => ({ body: { item } }),
      output: struct.object({ ok: struct.boolean() }),
    });

    const observedKeys: string[] = [];
    let attempt = 0;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withRetry({ methods: ["POST"], maxRetries: 2, delayMs: 1, jitter: 0 }),
      withInterceptors(idempotencyKeyHttpInterceptor()),
      withHTTPHandle((input) => {
        const request = input instanceof Request ? input : new Request(input);
        observedKeys.push(request.headers.get("Idempotency-Key") ?? "");
        attempt += 1;
        if (attempt < 3) {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return Promise.resolve(Response.json({ ok: true }, { status: 200 }));
      }),
    );

    const [err1, data1] = await createOrder(client, { item: "book" });
    expect(err1).toBeNull();
    expect(data1).toEqual({ ok: true });
    expect(observedKeys).toHaveLength(3);
    expect(observedKeys[0]).toBeTruthy();
    expect(observedKeys[1]).toBe(observedKeys[0]);
    expect(observedKeys[2]).toBe(observedKeys[0]);

    const [err2] = await createOrder(client, { item: "pen" });
    expect(err2).toBeNull();
    expect(observedKeys).toHaveLength(4);
    expect(observedKeys[3]).not.toBe(observedKeys[0]);
  });

  test("caches custom generate() per correlationId across retries and evicts oldest entry beyond 4,096 keys", async () => {
    const createOrder = defineRequest({
      method: "POST",
      path: "/orders",
      output: struct.object({ ok: struct.boolean() }),
    });

    let seq = 0;
    const generate = vi.fn(() => `custom-${(seq += 1)}`);
    const seenKeys: string[] = [];
    let failAttempts = 2;

    const client = createClient(
      withEndpoint("https://api.example.test"),
      withRetry({ methods: ["POST"], maxRetries: 2, delayMs: 1, jitter: 0 }),
      withInterceptors(idempotencyKeyHttpInterceptor({ generate })),
      withHTTPHandle((input) => {
        const request = input instanceof Request ? input : new Request(input);
        seenKeys.push(request.headers.get("Idempotency-Key") ?? "");
        if (failAttempts > 0) {
          failAttempts -= 1;
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return Promise.resolve(Response.json({ ok: true }, { status: 200 }));
      }),
    );

    const [err] = await createOrder(client);
    expect(err).toBeNull();
    expect(seenKeys).toEqual(["custom-1", "custom-1", "custom-1"]);
    expect(generate).toHaveBeenCalledTimes(1);

    // LRU capacity (4096) eviction & recency refresh verification via direct chain calls.
    let lruSeq = 0;
    const lruGen = vi.fn(() => `k-${(lruSeq += 1)}`);
    const lruChain = makeChain([
      idempotencyKeyHttpInterceptor({ generate: lruGen }).fn,
    ]);
    const keysByCall: string[] = [];
    const recordHandler = makeFakeHandler({
      response: { status: 200 },
      onRequestBefore: (req) => {
        keysByCall.push(req.headers?.get("Idempotency-Key") ?? "");
      },
    });

    for (let i = 0; i < 4096; i += 1) {
      await lruChain(
        {
          baseEndpoint: "https://example.test",
          endpoint: "/orders",
          method: "POST",
          correlationId: `cid-${i}`,
        },
        recordHandler,
      );
    }
    expect(lruGen).toHaveBeenCalledTimes(4096);

    // Touch cid-0 so cid-1 becomes the least recently used entry.
    await lruChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        method: "POST",
        correlationId: "cid-0",
      },
      recordHandler,
    );
    expect(lruGen).toHaveBeenCalledTimes(4096);
    expect(keysByCall.at(-1)).toBe("k-1");

    // Adding cid-4096 evicts cid-1 while keeping cid-0.
    await lruChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        method: "POST",
        correlationId: "cid-4096",
      },
      recordHandler,
    );
    expect(lruGen).toHaveBeenCalledTimes(4097);

    // cid-0 is still cached.
    await lruChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        method: "POST",
        correlationId: "cid-0",
      },
      recordHandler,
    );
    expect(lruGen).toHaveBeenCalledTimes(4097);

    // cid-1 was evicted and generates a fresh value.
    await lruChain(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/orders",
        method: "POST",
        correlationId: "cid-1",
      },
      recordHandler,
    );
    expect(lruGen).toHaveBeenCalledTimes(4098);
    expect(keysByCall.at(-1)).toBe("k-4098");
  });
});
