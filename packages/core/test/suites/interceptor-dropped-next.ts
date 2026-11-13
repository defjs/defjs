import { expect, onTestFinished, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  defineRequest,
  makeResponse,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../../src/index.ts";
import { yieldMacrotask } from "../macrotask.ts";

/** Reports every promise rejection the runtime considers unhandled to `record`; returns the function that stops reporting. */
export type SubscribeUnhandledRejections = (
  record: (reason: unknown) => void,
) => () => void;

/** Node.js and Bun report an unhandled rejection through the process `unhandledRejection` event. */
export const subscribeProcessRejections: SubscribeUnhandledRejections = (
  record,
) => {
  // Vitest's own listener stays registered. It ignores the event while another listener exists.
  process.on("unhandledRejection", record);
  return () => {
    process.off("unhandledRejection", record);
  };
};

/** Browsers report an unhandled rejection through the window `unhandledrejection` event. */
export const subscribeWindowRejections: SubscribeUnhandledRejections = (
  record,
) => {
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    record(event.reason);
  };
  // Vitest's own listener logs each event once a test registers one of its own.
  const silence = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    silence.mockRestore();
  };
};

/** Runs `run`, then returns every promise rejection reported as unhandled while it ran. */
async function collectUnhandledRejections(
  subscribe: SubscribeUnhandledRejections,
  run: () => Promise<void>,
): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const sentinel = new Error("flush unhandled rejections");
  const flushed = Promise.withResolvers<void>();
  // The test hook also runs when `run` or the flush never settles and the test times out.
  onTestFinished(
    subscribe((reason) => {
      if (reason === sentinel) flushed.resolve();
      else reasons.push(reason);
    }),
  );
  await run();
  // Reports arrive in order, so the sentinel's proves that every earlier one has. The macrotask lets the
  // rejections that `run` caused settle first.
  await yieldMacrotask();
  void Promise.reject(sentinel);
  await flushed.promise;
  return reasons;
}

export function registerInterceptorDroppedNextSuite(
  subscribe: SubscribeUnhandledRejections,
): void {
  test("HTTP lets an interceptor drop next() without an unhandled rejection", async () => {
    const endpoint = defineRequest({ method: "GET", path: "/dropped" });
    const sent = Promise.withResolvers<void>();
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => {
        sent.resolve();
        return new Promise(() => undefined);
      }),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          void next(request);
          await sent.promise;
          return makeResponse({ status: 200, request });
        }),
      ),
    );
    let fault: unknown;
    const unhandled = await collectUnhandledRejections(subscribe, async () => {
      [fault] = await endpoint(client);
    });
    expect(fault).toBeNull();
    expect(unhandled).toEqual([]);
  });
}
