import { expect, inject, test, vi } from "vitest";
import { createClient, withEndpoint, withRetry } from "../client";
import type { RetryContext } from "../client/config";
import { defineRequest } from "./http";
import { struct } from "../struct";
import { fixture } from "../../test/fixture/client-auto";

const getJson = defineRequest({
  method: "GET",
  path: "/",
  output: struct.object({ ok: struct.boolean() }),
});

test("honors exposed Retry-After across retries against the fixture server", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const url = await f.endpoint("rate-limit", "script", {
    plan: [
      {
        status: 429,
        headers: {
          "retry-after": "0",
          "x-rate-limit-policy": "burst",
        },
        chunks: [],
        then: "end",
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        chunks: ['{"ok":true}'],
        then: "end",
      },
    ],
  });
  const contexts: RetryContext[] = [];
  const client = createClient(
    withEndpoint(url),
    withRetry({
      delayMs: 50,
      jitter: 0,
      shouldRetry(context) {
        contexts.push(context);
        return context.retryable;
      },
    }),
  );

  const [err, data] = await getJson(client);

  expect(err).toBeNull();
  expect(data).toEqual({ ok: true });
  expect(contexts).toHaveLength(1);
  expect(contexts[0]?.transport).toBe("http");
  if (contexts[0]?.transport === "http") {
    expect(contexts[0].status).toBe(429);
    expect(contexts[0].retryAfterMs).toBe(0);
    expect(contexts[0].headers?.get("retry-after")).toBe("0");
    expect(contexts[0].headers?.get("x-rate-limit-policy")).toBe("burst");
  }
  expect((await f.log()).requests).toHaveLength(2);
});

test("fast-fails immediately when exposed Retry-After exceeds maxRetryAfterMs", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const url = await f.endpoint("long-cooldown", "script", {
    plan: [
      {
        status: 503,
        headers: { "retry-after": "5" },
        chunks: [],
        then: "end",
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        chunks: ['{"ok":true}'],
        then: "end",
      },
    ],
  });
  const shouldRetry = vi.fn(() => true);
  const client = createClient(
    withEndpoint(url),
    withRetry({ maxRetryAfterMs: 500, shouldRetry }),
  );

  const [err] = await getJson(client);

  expect(err?.code).toBe("HTTP_STATUS");
  if (err?.code === "HTTP_STATUS") {
    expect(err.status).toBe(503);
  }
  expect(shouldRetry).not.toHaveBeenCalled();
  expect((await f.log()).requests).toHaveLength(1);
});
