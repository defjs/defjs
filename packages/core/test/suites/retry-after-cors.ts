import { expect, inject, test } from "vitest";
import { createClient, withEndpoint, withRetry } from "../../src/client";
import type { RetryContext } from "../../src/client/config";
import { defineRequest } from "../../src/http";
import { struct } from "../../src/struct";
import { fixture } from "../fixture/client-auto.ts";

const getJson = defineRequest({
  method: "GET",
  path: "/",
  output: struct.object({ ok: struct.boolean() }),
});

export function registerRetryAfterCorsSuite(): void {
  test("falls back to exponential backoff in browsers when cross-origin Retry-After is not exposed", async () => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    const url = await f.endpoint("unexposed-rate-limit", "script", {
      plan: [
        {
          status: 429,
          headers: { "retry-after": "5" },
          exposeHeaders: false,
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
        delayMs: 0,
        maxRetryAfterMs: 500,
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
      expect(contexts[0].headers?.get("retry-after")).toBeNull();
      expect(contexts[0].retryAfterMs).toBeUndefined();
    }
    expect((await f.log()).requests).toHaveLength(2);
  });
}
