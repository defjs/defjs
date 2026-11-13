import {
  ERR_ABORTED as pluginAborted,
  ERR_TIMEOUT as pluginTimeout,
} from "@defjs/core";
import { describe, expect, test, vi } from "vitest";
import { withOpenTelemetryServer } from "../option";
import { createMockLogger } from "../../test/mocks";

vi.resetModules();
const appCore = await import("@defjs/core");

describe("caller cancellation across two @defjs/core instances", () => {
  test("the second module instance and the plugin do not share sentinel identity", () => {
    expect(appCore.ERR_ABORTED).not.toBe(pluginAborted);
    expect(appCore.ERR_TIMEOUT).not.toBe(pluginTimeout);
  });

  test("does not log caller cancellation when the client comes from another core instance", async () => {
    const { logger, records } = createMockLogger();
    const abort = new AbortController();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = appCore.createClient(
      appCore.withEndpoint("https://example.invalid"),
      appCore.withHTTPHandle(() => {
        markStarted();
        return new Promise<Response>(() => undefined);
      }),
      withOpenTelemetryServer({ logger }),
    );
    const readInventory = appCore.defineRequest({
      method: "GET",
      path: "/inventory",
    });
    const pending = readInventory(client({ signal: abort.signal }));
    await started;
    abort.abort();

    const [fault] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(records).toEqual([]);
  });

  test("still logs a timeout from another core instance", async () => {
    const { logger, records } = createMockLogger();
    const abort = new AbortController();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = appCore.createClient(
      appCore.withEndpoint("https://example.invalid"),
      appCore.withHTTPHandle(() => {
        markStarted();
        return new Promise<Response>(() => undefined);
      }),
      withOpenTelemetryServer({ logger }),
    );
    const readInventory = appCore.defineRequest({
      method: "GET",
      path: "/inventory",
    });
    const pending = readInventory(client({ signal: abort.signal }));
    await started;
    abort.abort(new DOMException("deadline", "TimeoutError"));

    const [fault] = await pending;
    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventName: "http.client.request.exception",
      severityText: "WARN",
    });
  });
});
