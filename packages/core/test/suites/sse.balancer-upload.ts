import { expect, test, vi } from "vitest";
import type {
  Balancer,
  DoneInfo,
  PickInfo,
  PickOutcome,
} from "../../src/balancer/index.ts";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withSSEHandle,
  withSSEReconnect,
} from "../../src/client/index.ts";
import { struct } from "../../src/struct/index.ts";
import { defineEventStream } from "../../src/sse/index.ts";
import {
  uploadOutcome,
  type UploadCapability,
  type UploadOutcome,
} from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

const RECONNECT = { attempts: 1, delayMs: 0, factor: 1 };

interface Recorded {
  balancer: Balancer;
  picks: PickInfo[];
  dones: Array<{ endpoint: string; info: DoneInfo }>;
  ends: Array<{ endpoint: string; info: DoneInfo }>;
  pending(): number;
}

function track(
  choose: (index: number, info: PickInfo) => string | PickOutcome,
): Recorded {
  const picks: PickInfo[] = [];
  const dones: Array<{ endpoint: string; info: DoneInfo }> = [];
  const ends: Array<{ endpoint: string; info: DoneInfo }> = [];
  let pending = 0;
  return {
    picks,
    dones,
    ends,
    pending: () => pending,
    balancer: {
      pick(info) {
        picks.push(info);
        const choice = choose(picks.length, info);
        if (typeof choice !== "string") {
          return choice;
        }
        pending += 1;
        return [
          null,
          {
            endpoint: choice,
            end(info) {
              ends.push({ endpoint: choice, info });
            },
            done(doneInfo) {
              pending -= 1;
              dones.push({ endpoint: choice, info: doneInfo });
            },
          },
        ];
      },
    },
  };
}

function oneByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
}

function expectUnsupportedStream(
  outcome: UploadOutcome,
  attempt: {
    fault: { code: string; cause?: unknown } | null;
    handleCalls: number;
    body: ReadableStream<Uint8Array>;
  },
): void {
  switch (outcome) {
    case "observed":
      return;
    case "unsupported":
      expectUploadOutcome(outcome, {
        error: attempt.fault,
        result: undefined,
        response: undefined,
        observerCalls: 0,
      });
      expect(attempt.handleCalls).toBe(0);
      expect(attempt.body.locked).toBe(false);
      return;
    case "bypassed":
    case "unreachable":
      throw new Error(`a custom ReadableStream upload is not ${outcome}`);
  }
}

export function registerSseBalancerUploadSuite(cap: UploadCapability): void {
  test("does not repick a ReadableStream body after the handle rejects", async () => {
    const body = oneByteStream();
    const streamBody = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      method: "POST",
      operation: "orders",
      path: "/events",
    });
    const handle = vi.fn(() => Promise.reject(new TypeError("down")));
    const streamRecord = track(() => "https://example.com");
    const [streamError] = await streamBody(
      createClient(
        withEndpoint("https://example.com"),
        withBalancer(streamRecord.balancer),
        withSSEHandle(handle),
        withSSEReconnect({ ...RECONNECT, shouldReconnect: () => true }),
      ),
    );
    const outcome = uploadOutcome(cap, "ReadableStream", "custom");
    expect(streamRecord.picks).toHaveLength(1);
    expect(streamRecord.pending()).toBe(0);
    if (outcome !== "observed") {
      expectUnsupportedStream(outcome, {
        fault: streamError,
        handleCalls: handle.mock.calls.length,
        body,
      });
      return;
    }

    expect(streamError?.code).toBe("NET_UNREACHABLE");
    expect(handle).toHaveBeenCalledTimes(1);
  });

  test("applies the reconnect gate to a ReadableStream 503 handshake", async () => {
    const body = oneByteStream();
    const busy = vi.fn(() =>
      Promise.resolve(new Response("busy", { status: 503 })),
    );
    const streamBody = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      method: "POST",
      operation: "orders",
      path: "/events",
    });
    const [error] = await streamBody(
      createClient(
        withEndpoint("https://example.com"),
        withSSEHandle(busy),
        withSSEReconnect({ ...RECONNECT, shouldReconnect: () => true }),
      ),
    );
    const outcome = uploadOutcome(cap, "ReadableStream", "custom");
    if (outcome !== "observed") {
      expectUnsupportedStream(outcome, {
        fault: error,
        handleCalls: busy.mock.calls.length,
        body,
      });
      return;
    }

    expect(error).toMatchObject({ code: "HTTP_STATUS", status: 503 });
    expect(busy).toHaveBeenCalledOnce();
  });
}
