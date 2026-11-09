import { beforeEach, describe, expect, inject, test } from "vitest";

import { createClient, withEndpoint } from "../client";
import type { Client } from "../client";
import { struct } from "../struct";
import { defineEventStream } from "./index";

describe("sse against the fixture server", () => {
  let baseClient: Client;

  beforeEach(() => {
    baseClient = createClient(withEndpoint(inject("testServerHost")));
  });

  test("should consume event streams", async () => {
    const useBasicStream = defineEventStream({
      events: {
        message: struct.string(),
      },
      path: "/sse/basic",
    });

    const [error, stream, open] = await useBasicStream(baseClient);

    expect(error).toBeNull();
    expect(open?.response?.ok).toBe(true);
    if (!stream) {
      throw new Error("Expected event stream");
    }

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.data);
    }

    expect(events).toEqual(["first", "second line 1\nsecond line 2"]);
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should return the fixed error tuple for non-2xx open responses", async () => {
    const useFailedStream = defineEventStream({
      events: {
        message: struct.string(),
      },
      path: "/500",
    });

    const [error, stream, open] = await useFailedStream(baseClient);

    expect(error?.code).toBe("HTTP_STATUS");
    expect(stream).toBeUndefined();
    expect(open?.response?.status).toBe(500);
  });

  test("should close an open stream when browser iteration stops early", async () => {
    const useStream = defineEventStream({
      events: { tick: struct.string() },
      path: "/sse/infinite",
    });
    const [error, stream] = await useStream(baseClient);

    expect(error).toBeNull();
    if (!stream) {
      throw new Error("Expected event stream");
    }

    for await (const event of stream) {
      expect(event.event).toBe("tick");
      break;
    }

    await expect(stream.closed).resolves.toMatchObject({
      kind: "aborted",
      reason: "iterator-return",
    });
  });

  test("should skip unexpected events", async () => {
    const useStream = defineEventStream({
      events: {
        message: struct.number(),
      },
      path: "/sse/basic",
    });

    const [error, stream] = await useStream(baseClient);

    expect(error).toBeNull();
    if (!stream) {
      throw new Error("Expected event stream");
    }

    const events: unknown[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });
});
