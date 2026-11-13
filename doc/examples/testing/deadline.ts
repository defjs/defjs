// #region example
import { expect, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const getStatus = defineRequest({ method: "GET", path: "/status" });

test("request deadline follows the controlled timer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("request deadline", "TimeoutError"));
  }, 100);
  try {
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = createClient(
      withEndpoint("https://fixture.invalid"),
      withHTTPHandle(() => {
        started?.();
        return new Promise<Response>(() => {});
      }),
    );
    const pending = getStatus(client({ signal: controller.signal }));
    await ready;
    await vi.advanceTimersByTimeAsync(100);
    const [err] = await pending;
    expect(err?.code).toBe("NET_TIMEOUT");
  } finally {
    clearTimeout(timer);
    controller.abort();
    vi.useRealTimers();
  }
});
// #endregion
