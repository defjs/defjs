import { expect, test, vi } from "vitest";
import {
  startHonoTestServer,
  type HonoTestServer,
} from "../../../../test/hono-test-server";

vi.mock("../../../../test/hono-test-server", () => ({
  startHonoTestServer: vi.fn(),
}));

const { setup, teardown } = await import("../setup");

function fakeServer(close: HonoTestServer["close"]): HonoTestServer {
  return { host: "http://127.0.0.1:31000", close };
}

function startWith(server: HonoTestServer): void {
  vi.mocked(startHonoTestServer).mockResolvedValueOnce(server);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
}

function messages(failure: AggregateError | undefined): string[] {
  return (failure?.errors ?? []).map((error: Error) => error.message);
}

function aggregateCause(error: unknown): unknown {
  if (!(error instanceof AggregateError)) return undefined;
  const first: unknown = error.errors[0];
  if (typeof first !== "object" || first === null || !("cause" in first)) {
    return undefined;
  }
  return first.cause;
}

async function failedTeardown(): Promise<AggregateError | undefined> {
  try {
    await teardown();
    return undefined;
  } catch (error) {
    if (error instanceof AggregateError) {
      return error;
    }
    throw error;
  }
}

test("setup provides the server host and teardown closes the server once", async () => {
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  startWith(fakeServer(close));
  const provide = vi.fn();

  await setup({ provide });

  expect(startHonoTestServer).toHaveBeenCalledTimes(1);
  expect(provide).toHaveBeenCalledTimes(1);
  expect(provide).toHaveBeenCalledWith(
    "testServerHost",
    "http://127.0.0.1:31000",
  );
  expect(close).not.toHaveBeenCalled();

  await teardown();
  expect(close).toHaveBeenCalledTimes(1);

  await teardown();
  expect(close).toHaveBeenCalledTimes(1);
});

test("teardown reports a failed server close with its labeled original cause", async () => {
  const injected = new Error("injected close failure");
  const close = vi.fn<() => Promise<void>>().mockRejectedValue(injected);
  startWith(fakeServer(close));

  await setup({ provide: vi.fn() });
  const failure = await failedTeardown();

  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure?.message).toBe("Test server teardown failed");
  expect(messages(failure)).toEqual([
    "HTTP server close failed: injected close failure",
  ]);
  expect(aggregateCause(failure)).toBe(injected);

  expect(await failedTeardown()).toBeUndefined();
  expect(close).toHaveBeenCalledTimes(1);
});

test("teardown reports a server close that never completes as a labeled timeout", async () => {
  const close = vi
    .fn<() => Promise<void>>()
    .mockImplementation(() => new Promise<void>(() => undefined));
  startWith(fakeServer(close));

  await setup({ provide: vi.fn() });
  try {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = failedTeardown();
    await vi.runOnlyPendingTimersAsync();
    const failure = await pending;

    expect(failure?.message).toBe("Test server teardown failed");
    expect(messages(failure)).toEqual([
      "HTTP server close failed: HTTP server close timed out",
    ]);
    expect(aggregateCause(failure)).toMatchObject({
      message: "HTTP server close timed out",
    });
  } finally {
    vi.useRealTimers();
  }
});
