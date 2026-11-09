import { expect, test } from "vitest";
import type { DoneInfo, PickInfo } from "../../src/balancer/index.ts";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
  type ClientOption,
  type RetryOptions,
} from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { createHttpInterceptor } from "../../src/interceptor/index.ts";
import {
  uploadOutcome,
  type UploadCapability,
  type UploadOutcome,
} from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

const endpoints = ["https://first.test", "https://second.test"];

function policy(options: RetryOptions = {}): ClientOption {
  return withRetry({ delayMs: 0, ...options });
}

function fixture(...options: ClientOption[]) {
  const requests: Request[] = [];
  const picks: PickInfo[] = [];
  const reports: DoneInfo[] = [];
  const client = createClient(
    withEndpoint(...endpoints),
    withBalancer({
      pick(info) {
        picks.push(info);
        return [
          null,
          {
            endpoint: info.endpoints[0] ?? "",
            done: (report) => reports.push(report),
          },
        ];
      },
    }),
    withHTTPHandle((input) => {
      const request = new Request(input);
      requests.push(request);
      if (request.url.startsWith(endpoints[0] ?? ""))
        return Promise.reject(new TypeError("connection refused"));
      return Promise.resolve(new Response("ok"));
    }),
    policy(),
    ...options,
  );
  return { client, requests, picks, reports };
}

function closedStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function expectCustomStream(
  outcome: UploadOutcome,
  attempt: {
    fault: { code: string; cause?: unknown } | null;
    result: unknown;
    response: unknown;
    requests: readonly Request[];
    body: ReadableStream<Uint8Array> | undefined;
  },
): void {
  switch (outcome) {
    case "observed":
      expect(attempt.fault?.code).toBe("NET_UNREACHABLE");
      expect(attempt.requests).toHaveLength(1);
      return;
    case "unsupported":
      expectUploadOutcome(outcome, {
        error: attempt.fault,
        result: attempt.result,
        response: attempt.response,
        observerCalls: 0,
      });
      expect(attempt.requests).toHaveLength(0);
      expect(attempt.body?.locked).toBe(false);
      return;
    case "bypassed":
    case "unreachable":
      throw new Error(`a custom ReadableStream upload is not ${outcome}`);
  }
}

export function registerHttpFailoverUploadSuite(cap: UploadCapability): void {
  test("ReadableStream requests never fail over even for an opted-in POST", async () => {
    const body = closedStream();
    const { client, requests } = fixture(
      policy({ maxAttempts: 2, methods: ["POST"], on: ["connect-failure"] }),
    );
    const [fault, result, response] = await defineRequest({
      method: "POST",
      path: "/",
      builder: () => ({ body }),
    })(client);
    expectCustomStream(uploadOutcome(cap, "ReadableStream", "custom"), {
      fault,
      result,
      response,
      requests,
      body,
    });
  });

  test("an interceptor that substitutes a ReadableStream body disables failover", async () => {
    const replaced: ReadableStream<Uint8Array>[] = [];
    const { client, requests } = fixture(
      policy({ methods: ["POST"] }),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          const body = closedStream();
          replaced.push(body);
          return next({ ...request, body });
        }),
      ),
    );
    const [fault, result, response] = await defineRequest({
      method: "POST",
      path: "/",
    })(client);
    expectCustomStream(uploadOutcome(cap, "ReadableStream", "custom"), {
      fault,
      result,
      response,
      requests,
      body: replaced[0],
    });
  });
}
