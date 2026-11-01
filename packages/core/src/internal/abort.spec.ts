import { afterEach, describe, expect, test, vi } from "vitest";
import {
  awaitWithSignal,
  mergeAbortSignals,
  releaseAbortSignal,
} from "./abort";

describe("abort helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("should merge abort signals and preserve single controller signal", () => {
    const controller = new AbortController();
    expect(mergeAbortSignals(controller.signal, [])).toBe(controller.signal);
    expect(
      mergeAbortSignals(controller.signal, [
        controller.signal,
        controller.signal,
      ]),
    ).toBe(controller.signal);

    const another = new AbortController();
    const merged = mergeAbortSignals(controller.signal, [another.signal]);
    another.abort("stop");

    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe("stop");
  });

  test("should skip undefined signals when another signal is present", () => {
    const controller = new AbortController();
    const another = new AbortController();
    const merged = mergeAbortSignals(controller.signal, [
      undefined,
      another.signal,
    ]);

    another.abort("stop");

    expect(merged).not.toBe(controller.signal);
    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe("stop");
    releaseAbortSignal(merged);
  });

  test("should release forwarding listeners and deduplicate identical sources", () => {
    const controller = new AbortController();
    const another = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const merged = mergeAbortSignals(controller.signal, [
      another.signal,
      another.signal,
    ]);

    expect(add).toHaveBeenCalledOnce();
    releaseAbortSignal(merged);

    expect(remove).toHaveBeenCalledExactlyOnceWith(
      "abort",
      add.mock.calls[0]?.[1],
    );
  });

  test("should resolve an asynchronous callback result", async () => {
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, "addEventListener");
    const remove = vi.spyOn(signal, "removeEventListener");

    await expect(
      awaitWithSignal(() => Promise.resolve(1), signal),
    ).resolves.toBe(1);

    expect(remove).toHaveBeenCalledExactlyOnceWith(
      "abort",
      add.mock.calls[0]?.[1],
    );
  });

  test("should stop waiting for a callback when aborted", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = awaitWithSignal(
      () => new Promise<never>(() => undefined),
      controller.signal,
    );

    controller.abort(new Error("stop"));

    await expect(result).rejects.toThrow("stop");
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      "abort",
      add.mock.calls[0]?.[1],
    );
  });

  test("should not invoke a callback when already aborted", async () => {
    const controller = new AbortController();
    const run = vi.fn();
    controller.abort(new Error("already stopped"));

    await expect(awaitWithSignal(run, controller.signal)).rejects.toThrow(
      "already stopped",
    );
    expect(run).not.toHaveBeenCalled();
  });

  test("should not start a queued callback after same-tick abort", async () => {
    const controller = new AbortController();
    const run = vi.fn();
    const result = awaitWithSignal(run, controller.signal);

    controller.abort(new Error("stop before start"));

    await expect(result).rejects.toThrow("stop before start");
    expect(run).not.toHaveBeenCalled();
  });

  test("should reject when a callback schedules abort before its result settles", async () => {
    const controller = new AbortController();
    const reason = new Error("stop before result");

    const result = awaitWithSignal(() => {
      queueMicrotask(() => controller.abort(reason));
      return "value";
    }, controller.signal);

    await expect(result).rejects.toBe(reason);
  });

  test("should consume a callback rejection that arrives after abort", async () => {
    const controller = new AbortController();
    const unhandled = vi.fn();
    let rejectTask: ((reason: unknown) => void) | undefined;
    process.on("unhandledRejection", unhandled);

    try {
      const result = awaitWithSignal(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectTask = reject;
          }),
        controller.signal,
      );
      controller.abort(new Error("stop"));
      await expect(result).rejects.toThrow("stop");

      rejectTask?.(new Error("late failure"));
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
