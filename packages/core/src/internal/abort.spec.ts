import { afterEach, describe, expect, test, vi } from "vitest";
import {
  awaitWithSignal,
  followAbort,
  hasAborted,
  mergeAbortSignals,
  releaseAbortSignal,
  stopsUnreadItems,
} from "./abort";
import { yieldMacrotask } from "../../test/macrotask";

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

  test("should still see a source that aborts after its merge was released", () => {
    const controller = new AbortController();
    const caller = new AbortController();
    const merged = mergeAbortSignals(controller.signal, [caller.signal]);
    expect(hasAborted(merged)).toBe(false);
    expect(hasAborted(undefined)).toBe(false);
    releaseAbortSignal(merged);

    caller.abort("stop");

    expect(merged.aborted).toBe(false);
    expect(hasAborted(merged)).toBe(true);
    expect(hasAborted(mergeAbortSignals(merged, []))).toBe(true);
  });

  test("followAbort aborts the controller with the source's reason when the source aborts", () => {
    const controller = new AbortController();
    const source = new AbortController();
    followAbort(controller, source.signal);

    source.abort("stop");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("stop");
  });

  test("followAbort aborts the controller at once for a source that is already aborted", () => {
    const controller = new AbortController();
    const source = AbortSignal.abort("gone");
    const add = vi.spyOn(source, "addEventListener");

    followAbort(controller, source);

    expect(controller.signal.reason).toBe("gone");
    expect(add).not.toHaveBeenCalled();
  });

  test("followAbort stops following once released, and leaves nothing on the source", () => {
    const controller = new AbortController();
    const source = new AbortController();
    const add = vi.spyOn(source.signal, "addEventListener");
    const remove = vi.spyOn(source.signal, "removeEventListener");

    followAbort(controller, source.signal)();
    source.abort("late");

    expect(controller.signal.aborted).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      "abort",
      add.mock.calls[0]?.[1],
    );
  });

  test("should drop unread items for any abort except a deadline that expired before the end", () => {
    const timeout = new DOMException("deadline", "TimeoutError");
    const stopped = new AbortController();
    stopped.abort("stop");
    const expired = new AbortController();
    expired.abort(timeout);

    expect(stopsUnreadItems(undefined, true)).toBe(false);
    expect(stopsUnreadItems(new AbortController().signal, true)).toBe(false);
    expect(stopsUnreadItems(stopped.signal, false)).toBe(true);
    expect(stopsUnreadItems(stopped.signal, true)).toBe(true);
    expect(stopsUnreadItems(expired.signal, false)).toBe(false);
    expect(stopsUnreadItems(expired.signal, true)).toBe(true);
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
    let rejectTask: ((reason: unknown) => void) | undefined;

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
    await yieldMacrotask();
  });
});
