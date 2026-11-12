import { expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  type ClientOption,
} from "../client/option";
import type { HttpRequest } from "../internal/http_request";
import { createHttpInterceptor } from "../interceptor";
import { createResolvedRequestUrl } from "../internal/url";
import { defineRequest } from "./http";

// A request that cannot be sent is found before the transport runs. What an interceptor sees from
// next() is then the error that caused it, never a library class, and the fault is still built from it.

const send = defineRequest({
  method: "POST",
  path: "/",
  builder: () => ({ body: "payload" }),
});

type Rewrite = (request: HttpRequest) => HttpRequest;

function fixture(rewrite: Rewrite, ...options: ClientOption[]) {
  const seen: unknown[] = [];
  const handle = vi.fn(() => Promise.resolve(new Response("ok")));
  const client = createClient(
    withEndpoint("https://first.test"),
    withHTTPHandle(handle),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        try {
          return await next(rewrite(request));
        } catch (error) {
          seen.push(error);
          throw error;
        }
      }),
    ),
    ...options,
  );
  return { client, handle, seen };
}

function expectPlatformTypeError(error: unknown): void {
  expect(error).toBeInstanceOf(TypeError);
  expect(error instanceof Error && error.constructor).toBe(TypeError);
  expect(error instanceof Error && error.name).toBe("TypeError");
}

test.each([
  ["a method that is not a token", { method: "BAD METHOD" }],
  ["a forbidden method", { method: "TRACE" }],
  ["a GET with a body", { method: "GET" }],
  ["a URL with credentials", { baseEndpoint: "https://user:pw@first.test" }],
  ["a Content-Type with a line break", { bodyContentType: "a\r\nb" }],
])(
  "an interceptor that rewrites the request into %s sees a platform TypeError and the call fails as a build failure",
  async (_label, patch) => {
    const { client, handle, seen } = fixture((request) => ({
      ...request,
      ...patch,
    }));

    const [fault] = await send(client);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(seen).toHaveLength(1);
    expectPlatformTypeError(seen[0]);
    expect(fault?.cause).toBe(seen[0]);
    expect(handle).not.toHaveBeenCalled();
  },
);

test("a client endpoint with credentials is shown to an interceptor as a platform TypeError too", async () => {
  const { client, handle, seen } = fixture(
    (request) => request,
    withEndpoint("https://user:pw@first.test"),
  );

  const [fault] = await send(client);

  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(seen).toHaveLength(1);
  expectPlatformTypeError(seen[0]);
  expect(fault?.cause).toBe(seen[0]);
  expect(handle).not.toHaveBeenCalled();
});

test.each([
  ["an Error", new RangeError("token store down")],
  ["a string", "token store down"],
])(
  "a finalizeHeaders hook that throws %s is shown to the interceptor as that value",
  async (_label, thrown) => {
    const { client, handle, seen } = fixture(
      (request) => request,
      (config) => {
        config.finalizeHeaders = () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- the hook under test may throw a primitive
          throw thrown;
        };
      },
    );

    const [fault] = await send(client);

    expect(fault?.code).toBe("EXT_HOOK_FAILED");
    expect(seen).toEqual([thrown]);
    expect(fault?.cause).toBe(thrown);
    expect(handle).not.toHaveBeenCalled();
  },
);

test("an interceptor that rethrows what next() rejected with keeps the fault code", async () => {
  const { client } = fixture((request) => ({ ...request, method: "TRACE" }));

  const [fault] = await send(client);

  expect(fault?.code).toBe("REQ_BUILD_FAILED");
});

test("an invalid URL that an interceptor resolves itself is a build failure too", async () => {
  const handle = vi.fn(() => Promise.resolve(new Response("ok")));
  const client = createClient(
    withEndpoint("https://first.test"),
    withHTTPHandle(handle),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        createResolvedRequestUrl("https://first.test", "//other.test/");
        return next(request);
      }),
    ),
  );

  const [fault] = await send(client);

  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(handle).not.toHaveBeenCalled();
});

test("an interceptor that wraps what next() rejected with owns the failure", async () => {
  const wrapper = new Error("wrapped");
  const client = createClient(
    withEndpoint("https://first.test"),
    withHTTPHandle(() => Promise.resolve(new Response("ok"))),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        try {
          return await next({ ...request, method: "TRACE" });
        } catch (error) {
          throw new Error("wrapped", { cause: error });
        }
      }),
    ),
  );

  const [fault] = await send(client);

  expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
  expect(fault?.message).toBe(wrapper.message);
});
