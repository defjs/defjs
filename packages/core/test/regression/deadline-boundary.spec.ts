import { expect, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  defineRequest,
  makeResponse,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../../src";

test.each([
  ["interceptor", 4, false, null],
  ["interceptor", 4, true, "EXT_INTERCEPTOR_FAILED"],
  ["interceptor", 6, false, "NET_TIMEOUT"],
  ["interceptor", 6, true, "NET_TIMEOUT"],
  ["fetch", 4, false, null],
  ["fetch", 4, true, "NET_UNREACHABLE"],
  ["fetch", 6, false, "NET_TIMEOUT"],
  ["fetch", 6, true, "NET_TIMEOUT"],
] as const)(
  "%s uses wall-clock cancellation priority after %ims (throws=%s)",
  async (stage, elapsed, throws, expectedCode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 1000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const failure = new Error("synchronous callback failed");
    let callbackRuns = 0;
    let fetches = 0;
    const callback = () => {
      callbackRuns += 1;
      clock += elapsed;
      if (throws) throw failure;
    };
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async () => {
        fetches += 1;
        callback();
        return new Response(null, { status: 204 });
      }),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          if (stage === "fetch") return next(request);
          callback();
          return makeResponse({ status: 204 });
        }),
      ),
    );
    const endpoint = defineRequest({ method: "GET", path: "/deadline" });

    try {
      const [fault, result, response] = await client.execute(endpoint(), {
        timeout: 5,
      });

      expect(callbackRuns).toBe(1);
      expect(fetches).toBe(stage === "fetch" ? 1 : 0);
      expect(fault?.code ?? null).toBe(expectedCode);
      expect(result).toBeUndefined();
      if (expectedCode === null) {
        expect(response?.status).toBe(204);
      } else {
        expect(response).toBeUndefined();
        if (elapsed < 5) expect(fault?.cause).toBe(failure);
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      now.mockRestore();
      vi.useRealTimers();
    }
  },
);

test("a one-millisecond deadline can settle before the interceptor announces startup", async () => {
  const interceptor = vi.fn(async () => new Promise<never>(() => undefined));
  const client = createClient(
    withEndpoint("https://example.test"),
    withInterceptors(createHttpInterceptor(interceptor)),
  );
  const endpoint = defineRequest({ method: "GET", path: "/probe" });
  const now = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(1000)
    .mockReturnValue(1002);
  try {
    const [fault] = await client.execute(endpoint(), { timeout: 1 });
    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(interceptor).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});
