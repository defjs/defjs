import { beforeEach, describe, expect, inject, test, vi } from "vitest";
import {
  createClient,
  type DerivableClient,
  type FetchHandle,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../client";
import { ERR_ABORTED } from "../error";
import { createHttpInterceptor } from "../interceptor";
import type { HttpResponse } from "../internal/http_response";
import { makeResponse } from "../internal/http_response";
import { StructError, struct } from "../struct";
import { createPrimitiveStruct } from "../struct/runtime";
import { MALFORMED_INTERCEPTOR_RESULTS } from "../../test/malformed_interceptor_results";
import { defineRequest } from "./index";

describe("request http runtime errors", () => {
  let client: DerivableClient;

  beforeEach(() => {
    client = createClient(withEndpoint(inject("testServerHost")));
  });

  test.each(["", "text/plain"])(
    "should reject a synthetic JSON response with content type %j before decoding",
    async (contentType) => {
      const body = new Blob(['{"id":1}']);
      const read = vi.spyOn(body, "text");
      const useRequest = defineRequest({
        method: "GET",
        output: struct.object({ id: struct.number() }),
        path: "/synthetic-json",
      });
      const syntheticClient = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createHttpInterceptor(() =>
            Promise.resolve(
              makeResponse({
                body,
                headers: new Headers({ "content-type": contentType }),
                status: 200,
              }),
            ),
          ),
        ),
      );

      const [fault, data, response] = await useRequest(syntheticClient);

      expect(fault?.code).toBe("RES_MEDIA_TYPE_INVALID");
      expect(fault?.cause).toBeInstanceOf(TypeError);
      expect(fault?.message).toBe(
        `Expected a JSON media type, received ${contentType || "<none>"}`,
      );
      expect(fault?.response).not.toHaveProperty("body");
      expect(data).toBeUndefined();
      expect(response).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("should decode an absent synthetic body as empty content but reject a declared JSON media type that is missing", async () => {
    const syntheticClient = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(makeResponse({ status: 204 })),
        ),
      ),
    );
    const text = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/empty-text",
    });
    const json = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/empty-json",
    });
    const bytes = defineRequest({
      method: "GET",
      output: struct.arrayBuffer(),
      path: "/empty-bytes",
    });
    const blob = defineRequest({
      method: "GET",
      output: struct.blob(),
      path: "/empty-blob",
    });

    const [textFault, textData, textResponse] = await text(syntheticClient);
    const [jsonFault, jsonData, jsonResponse] = await json(syntheticClient);
    const [bytesFault, bytesData] = await bytes(syntheticClient);
    const [blobFault, blobData] = await blob(syntheticClient);

    expect(bytesFault).toBeNull();
    expect(bytesData).toBeInstanceOf(ArrayBuffer);
    expect(bytesData?.byteLength).toBe(0);
    expect(blobFault).toBeNull();
    expect(blobData).toBeInstanceOf(Blob);
    expect(blobData?.size).toBe(0);

    expect(textFault).toBeNull();
    expect(textData).toBe("");
    expect(textResponse?.body).toBe("");
    // The synthetic response has no JSON media type, which is checked before the absent body.
    expect(jsonFault?.code).toBe("RES_MEDIA_TYPE_INVALID");
    expect(jsonFault?.cause).toBeInstanceOf(TypeError);
    expect(jsonFault?.response).not.toHaveProperty("body");
    expect(jsonData).toBeUndefined();
    expect(jsonResponse).toBeUndefined();
  });

  test("should stop before the builder when an input decoder aborts the call", async () => {
    const controller = new AbortController();
    const builder = vi.fn(() => ({}));
    const input = createPrimitiveStruct<number>({
      decode(value) {
        controller.abort();
        return value;
      },
      expected: "number",
      is: (value): value is number => typeof value === "number",
      kind: "number",
    });
    const useRequest = defineRequest({
      builder,
      input,
      method: "GET",
      path: "/cancelled-input",
    });

    const [fault] = await useRequest(client({ signal: controller.signal }), 1);

    expect(fault?.code).toBe("NET_ABORTED");
    expect(builder).not.toHaveBeenCalled();
  });

  test("should let cancellation outrank an output decoder failure", async () => {
    const controller = new AbortController();
    const cause = new Error("decoder failed after abort");
    const decode = vi.fn(() => {
      controller.abort();
      throw cause;
    });
    const output = createPrimitiveStruct<string>({
      decode,
      expected: "string",
      is: (value): value is string => typeof value === "string",
      kind: "string",
    });
    const syntheticClient = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(makeResponse({ body: "text", status: 200 })),
        ),
      ),
    );
    const useRequest = defineRequest({
      method: "GET",
      output,
      path: "/cancelled-output",
    });

    const [fault, data, response] = await useRequest(
      syntheticClient({ signal: controller.signal }),
    );

    expect(decode).toHaveBeenCalledOnce();
    expect(fault?.code).toBe("NET_ABORTED");
    expect(data).toBeUndefined();
    expect(response).toBeUndefined();
  });

  test("should stop transport when interceptor resolution aborts the call", async () => {
    const controller = new AbortController();
    const handle = vi.fn<FetchHandle>();
    const fn = createHttpInterceptor((_request, next) => next(_request)).fn;
    const interceptor = {
      kind: "http" as const,
      get fn() {
        controller.abort();
        return fn;
      },
    };
    const guardedClient = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
      (config) => {
        config.interceptors.push(interceptor);
      },
    );
    const useRequest = defineRequest({
      method: "GET",
      path: "/cancelled-chain",
    });

    const [fault] = await useRequest(
      guardedClient({ signal: controller.signal }),
    );

    expect(fault?.code).toBe("NET_ABORTED");
    expect(handle).not.toHaveBeenCalled();
  });

  test("should report a SyntaxError from a text decode hook without claiming invalid JSON", async () => {
    const cause = new SyntaxError("private text decode failure");
    const text = createPrimitiveStruct<string>({
      decode: () => {
        throw cause;
      },
      expected: "string",
      is: (value): value is string => typeof value === "string",
      kind: "string",
    });
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: "plain text",
              headers: new Headers({ "content-type": "text/plain" }),
              status: 200,
            }),
          ),
        ),
      ),
    );
    const useRequest = defineRequest({
      method: "GET",
      output: text,
      path: "/text",
    });

    const [error, result] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(error?.code).toBe("RES_DECODE_FAILED");
    expect(error?.cause).toBe(cause);
    expect(error?.message).toBe("Response body could not be decoded");
    expect(String(error)).not.toContain("private text");
  });

  test("should resolve non-2xx responses as http errors with typed data", async () => {
    const useMissingAccount = defineRequest({
      method: "GET",
      error: struct.object({
        code: struct.string(),
        message: struct.string(),
      }),
      path: "/account/not-found",
    });

    const [error, result, response] = await useMissingAccount(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");

    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }

    expect(error.status).toBe(404);
    expect(error.response.ok).toBe(false);
    expect(error.response.status).toBe(404);
    expect(error.data).toEqual({
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found",
    });
  });

  test("should return request validation failures as definition errors", async () => {
    const useValidatedRequest = defineRequest({
      builder: () => ({}),
      input: struct.object({
        id: struct.number(),
      }),
      method: "GET",
      output: struct.null(),
      path: "/null",
    });

    const [error, result, response] = await useValidatedRequest(
      client,
      // @ts-expect-error id must be a number
      { id: "oops" },
    );

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("REQ_INPUT_INVALID");

    if (error?.code !== "REQ_INPUT_INVALID") {
      throw new Error("Expected an input fault");
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DefjsFault");
    expect(error.cause).toBeInstanceOf(StructError);
    if (!(error.cause instanceof StructError)) {
      throw new Error("Expected the original StructError cause");
    }
    expect(error.cause.format()._errors).toEqual([]);
    expect(error.cause.flatten().fieldErrors["id"]).toEqual([
      "Expected number at id, received string",
    ]);
    expect(error.cause.prettify()).toBe(
      "× id: Expected number at id, received string",
    );
    expect(error.cause.issues[0]?.received).toBe("oops");
    expect(String(error)).toBe(
      "DefjsFault: Expected number at id, received string",
    );
    expect(String(error)).not.toContain("oops");
  });

  test("should stop before build and transport when a required input field is missing", async () => {
    let buildCalls = 0;
    let transportCalls = 0;
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() => {
          transportCalls += 1;
          return Promise.resolve(makeResponse({ status: 200 }));
        }),
      ),
    );
    const useRequest = defineRequest({
      builder(input) {
        buildCalls += 1;
        return { query: { page: input.page } };
      },
      input: struct.object({ page: struct.number() }),
      method: "GET",
      path: "/search",
    });

    const [error, result, response] = await useRequest(
      guardedClient,
      // @ts-expect-error required input field is missing
      {},
    );

    expect(error?.code).toBe("REQ_INPUT_INVALID");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(buildCalls).toBe(0);
    expect(transportCalls).toBe(0);
  });

  test("should return response validation failures as definition errors", async () => {
    const useBadResponse = defineRequest({
      method: "GET",
      output: struct.object({
        id: struct.string(),
      }),
      path: "/json",
    });

    const [error, result, response] = await useBadResponse(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("RES_STRUCT_MISMATCH");

    if (error?.code !== "RES_STRUCT_MISMATCH") {
      throw new Error("Expected a struct mismatch fault");
    }

    expect(error.response.status).toBe(200);
  });

  test.each([
    {
      cause: TypeError,
      code: "RES_MEDIA_TYPE_INVALID",
      path: "/text",
      status: 200,
    },
    {
      cause: SyntaxError,
      code: "RES_DECODE_FAILED",
      path: "/json/malformed-error",
      status: 500,
    },
  ] as const)(
    "should stop on a declared response representation error with $code",
    async ({ cause, code, path, status }) => {
      const useRequest = defineRequest({
        method: "GET",
        output: struct.object({ id: struct.number() }),
        error: struct.object({ code: struct.string() }),
        path,
      });

      const [error, result, response] = await useRequest(client);

      expect(result).toBeUndefined();
      expect(response).toBeUndefined();
      expect(error?.code).toBe(code);
      if (error?.code !== code) {
        throw new Error(`Expected a ${code} fault`);
      }
      expect(error.response.status).toBe(status);
      expect(error.cause).toBeInstanceOf(cause);
      // Philosophy 4: an unreadable body leaves no body and no decoded value.
      expect(error.response).not.toHaveProperty("body");
      expect(error).not.toHaveProperty("data");
    },
  );

  test("should ignore an unreadable body on the side that declared nothing", async () => {
    const useRequest = defineRequest({
      method: "GET",
      output: struct.null(),
      path: "/json/malformed-error",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    // Philosophy 5: no `error` struct was declared, so the 500's malformed body is none of our
    // business — not even the fact that it could not be read.
    expect(error?.code).toBe("HTTP_STATUS");
    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }
    expect(error.status).toBe(500);
    expect(error.data).toBeUndefined();
    expect(error.response).not.toHaveProperty("body");
  });

  test("should report a non-2xx status without a declared error struct as an undecoded fault", async () => {
    const useUndecodedError = defineRequest({
      method: "GET",
      output: struct.null(),
      path: "/500",
    });

    const [error, result, response] = await useUndecodedError(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");

    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }

    expect(error.status).toBe(500);
    expect(error.response.status).toBe(500);
    expect(error.data).toBeUndefined();
  });

  test("should return definition error when build throws", async () => {
    const useBadBuild = defineRequest({
      builder: () => {
        throw new Error("build failed");
      },
      input: struct.object({}),
      method: "GET",
      path: "/test",
    });

    const [error, result, response] = await useBadBuild(client, {});

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("REQ_BUILD_FAILED");

    if (error?.code !== "REQ_BUILD_FAILED") {
      throw new Error("Expected a build fault");
    }
  });

  test("should return REQ_BUILD_FAILED when the JSON body is a Map", async () => {
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
    );
    const useRequest = defineRequest({
      // @ts-expect-error Map is not a request body
      builder: () => ({ body: new Map<string, string>() }),
      method: "POST",
      path: "/users",
    });

    const [fault, result, response] = await useRequest(guardedClient);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(
      fault?.cause instanceof TypeError ? fault.cause.message : "",
    ).toMatch(/Map/);
    expect(handle).toHaveBeenCalledTimes(0);
  });

  test("should return REQ_BUILD_FAILED when the JSON body is an async iterable object", async () => {
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
    );
    const useRequest = defineRequest({
      builder: () => ({
        body: {
          async *[Symbol.asyncIterator]() {
            yield await Promise.resolve(new TextEncoder().encode("chunk"));
          },
        },
      }),
      method: "POST",
      path: "/users",
    });

    const [fault, result, response] = await useRequest(guardedClient);

    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(fault?.cause).toBeInstanceOf(TypeError);
    expect(
      fault?.cause instanceof TypeError ? fault.cause.message : "",
    ).toMatch(/iterable object/);
    expect(handle).toHaveBeenCalledTimes(0);
  });

  test("should return a definition error when interceptor chain throws", async () => {
    const throwingInterceptor = createHttpInterceptor(() =>
      Promise.reject(new Error("interceptor boom")),
    );

    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(throwingInterceptor),
    );

    const useIntercepted = defineRequest({
      method: "GET",
      output: struct.null(),
      path: "/intercepted",
    });

    const [error, result, response] = await useIntercepted(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("EXT_INTERCEPTOR_FAILED");

    if (error?.code !== "EXT_INTERCEPTOR_FAILED") {
      throw new Error("Expected an interceptor fault");
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBeInstanceOf(Error);
    if (!(error.cause instanceof Error)) {
      throw new Error("expected Error cause");
    }
    expect(error.cause.message).toBe("interceptor boom");
  });

  test.each([
    ["abort", "NET_ABORTED"],
    ["timeout", "NET_TIMEOUT"],
  ] as const)(
    "should cancel a hanging interceptor on %s",
    async (mode, expectedCode) => {
      const controller = new AbortController();
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const guardedClient = createClient(
        withEndpoint("https://example.com"),
        withInterceptors(
          createHttpInterceptor(async () => {
            markStarted();
            return await new Promise(() => undefined);
          }),
        ),
      );
      const useRequest = defineRequest({
        method: "GET",
        path: "/hanging-interceptor",
      });

      const pending = useRequest(guardedClient({ signal: controller.signal }));
      await started;
      controller.abort(
        mode === "timeout"
          ? new DOMException("deadline", "TimeoutError")
          : "caller stopped",
      );

      const result = await pending;
      expect(result[0]).toMatchObject({ code: expectedCode });
    },
  );

  test("should prefer cancellation when an interceptor aborts and returns a response", async () => {
    const controller = new AbortController();
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() => {
          controller.abort("caller stopped");
          return Promise.resolve(makeResponse({ status: 200 }));
        }),
      ),
    );
    const useRequest = defineRequest({ method: "GET", path: "/cached" });

    const [error, result, response] = await useRequest(
      guardedClient({ signal: controller.signal }),
    );

    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
  });

  test.each(["return", "throw"] as const)(
    "should abort a hidden transport when an interceptor chain settles by %s",
    async (mode) => {
      const interceptorError = new Error("interceptor failed");
      let hiddenResponse: Promise<HttpResponse<unknown>> | undefined;
      let transportSignal: AbortSignal | undefined;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const fetchMock = vi.fn<FetchHandle>(async (input) => {
        if (!(input instanceof Request)) throw new Error("expected Request");
        const request = input;
        transportSignal = request.signal;
        markStarted();
        return await new Promise<Response>(() => undefined);
      });
      const guardedClient = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle(fetchMock),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            hiddenResponse = next(request);
            await started;
            if (mode === "throw") {
              throw interceptorError;
            }
            return makeResponse({ status: 204 });
          }),
        ),
      );
      const useRequest = defineRequest({ method: "GET", path: "/hidden" });

      const [error, result, response] = await useRequest(guardedClient);

      expect(transportSignal?.aborted).toBe(true);
      await expect(hiddenResponse).rejects.toBe(ERR_ABORTED);
      if (mode === "throw") {
        expect(error).toMatchObject({
          cause: interceptorError,
          code: "EXT_INTERCEPTOR_FAILED",
        });
        expect(error).toBeInstanceOf(Error);
        expect(response).toBeUndefined();
      } else {
        expect(error).toBeNull();
        expect(response?.status).toBe(204);
      }
      expect(result).toBeUndefined();
    },
  );

  test("should reject interceptor next calls after the HTTP chain settles", async () => {
    let lateResponse: Promise<HttpResponse<unknown>> | undefined;
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(fetchMock),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          setTimeout(() => {
            lateResponse = next(request);
            void lateResponse.catch(() => undefined);
          }, 0);
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );
    const useRequest = defineRequest({ method: "GET", path: "/cached" });

    const [error] = await useRequest(guardedClient);
    await vi.waitFor(() => expect(lateResponse).toBeDefined());

    expect(error).toBeNull();
    await expect(lateResponse).rejects.toThrow(
      "HTTP interceptor next() cannot be called after the chain has settled",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([ERR_ABORTED, "caller stopped", new Error("Request timed out")])(
    "should return aborted error when signal is already aborted with %s",
    async (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
      const guardedClient = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle(fetchMock),
      );

      const useRequest = defineRequest({
        method: "GET",
        output: struct.null(),
        path: "/null",
      });

      const [error, result, response] = await useRequest(
        guardedClient({ signal: controller.signal }),
      );

      expect(result).toBeUndefined();
      expect(response).toBeUndefined();
      expect(error?.code).toBe("NET_ABORTED");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("should snapshot HTTP signal before asynchronous work", async () => {
    let abortReads = 0;
    const options = {
      get signal() {
        abortReads += 1;
        return undefined;
      },
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(fetchMock),
    );
    const useRequest = defineRequest({ method: "GET", path: "/snapshot" });

    const [error, result, response] = await useRequest(guardedClient(options));

    expect(error).toBeNull();
    expect(result).toBeUndefined();
    expect(response?.status).toBe(204);
    expect(abortReads).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("should return ABORTED when signal is aborted with explicit undefined reason", async () => {
    const signal = { aborted: true, reason: undefined };

    const useRequest = defineRequest({
      method: "GET",
      output: struct.null(),
      path: "/null",
    });

    const [error, result, response] = await useRequest(
      // @ts-expect-error aborted signal whose reason is undefined cannot be built with AbortController
      client({ signal }),
    );

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("NET_ABORTED");
  });

  test("should classify an interceptor that throws the abort sentinel as cancellation", async () => {
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() => Promise.reject(ERR_ABORTED)),
      ),
    );
    const useRequest = defineRequest({
      method: "GET",
      path: "/transport-error",
    });

    const [error, result, response] = await useRequest(guardedClient);

    expect(error).toMatchObject({ cause: ERR_ABORTED, code: "NET_ABORTED" });
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
  });

  test("should classify an async download observer rejection as a transport error", async () => {
    const observerError = new Error("download observer failed");
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("ok", { headers: { "content-type": "text/plain" } }),
        ),
      ),
    );
    const useRequest = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/download",
    });

    const [error, result, response] = await useRequest(
      guardedClient({
        onDownloadProgress() {
          return Promise.reject(observerError);
        },
      }),
    );

    expect(error).toMatchObject({
      cause: observerError,
      code: "EXT_OBSERVER_FAILED",
    });
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
  });

  test("should use HTTP status message when response.error is undefined without output", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: null,
              status: 500,
              statusText: "Server Error",
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");
    expect(error?.response?.status).toBe(500);
    expect(error?.message).toContain("500");
  });

  test("should use HTTP status message when response.error is undefined with output struct", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: { code: "ERR" },
              headers: new Headers([["content-type", "application/json"]]),
              status: 500,
              statusText: "Server Error",
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      error: struct.object({ code: struct.string() }),
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");
    expect(error?.response?.status).toBe(500);
    expect(error?.message).toContain("500");
    if (error?.code === "HTTP_STATUS") {
      expect(error.data).toEqual({ code: "ERR" });
    }
  });

  test("should expose error on ref after failed request", async () => {
    const useBadRequest = defineRequest({
      builder: () => ({}),
      input: struct.object({
        id: struct.number(),
      }),
      method: "GET",
      output: struct.null(),
      path: "/null",
    });

    const [error] = await useBadRequest(
      client,
      // @ts-expect-error id must be a number
      { id: "invalid" },
    );

    expect(error?.code).toBe("REQ_INPUT_INVALID");
  });

  test("should cancel a pending request", async () => {
    const useDelay = defineRequest({
      builder: (input) => ({ query: { ms: input.ms } }),
      input: struct.object({ ms: struct.number() }),
      method: "GET",
      output: struct.null(),
      path: "/delay",
    });

    const controller = new AbortController();
    const promise = useDelay(client({ signal: controller.signal }), {
      ms: 5000,
    });
    controller.abort();

    const [error] = await promise;
    expect(error?.code).toBe("NET_ABORTED");
  });

  test("should return transport error with ABORTED code when interceptor aborts", async () => {
    const abortingInterceptor = createHttpInterceptor(async (req, next) => {
      const result = await next(req);
      if (result.status === 200) {
        throw ERR_ABORTED;
      }
      return result;
    });

    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        abortingInterceptor,
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: null,
              status: 200,
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      output: struct.null(),
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("NET_ABORTED");
  });

  test("should ignore a representation error when output is not declared", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: null,
              headers: new Headers(),
              status: 500,
              statusText: "Server Error",
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");
    expect(error?.response?.status).toBe(500);
    expect(error?.message).toBe("Http failure response: 500 - Server Error");
  });

  test("should decode an interceptor short-circuit through the same path as a real response", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: { code: "ERR" },
              headers: new Headers([["content-type", "application/json"]]),
              status: 500,
              statusText: "Server Error",
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      error: struct.object({ code: struct.string() }),
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");

    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }

    // Decoding happens once, after the chain: where a response came from does not change
    // how it is interpreted.
    expect(error.status).toBe(500);
    expect(error.data).toEqual({ code: "ERR" });
  });

  test("should return success for ok response without output", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: null,
              status: 204,
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(error).toBeNull();
    expect(result).toBeUndefined();
    expect(response?.ok).toBe(true);
  });

  test("should use Error message for non-ok response without output", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: null,
              status: 500,
              statusText: "Internal Server Error",
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");
    expect(error?.response?.status).toBe(500);
    expect(error?.message).toContain("500");
    expect(error?.message).toContain("Internal Server Error");
  });

  test("should use Error message for non-ok response with output struct", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(
            makeResponse({
              body: { code: "ERR" },
              headers: new Headers([["content-type", "application/json"]]),
              status: 500,
              statusText: "Server Error",
              url: "https://example.com/test",
            }),
          ),
        ),
      ),
    );

    const useRequest = defineRequest({
      method: "GET",
      error: struct.object({ code: struct.string() }),
      path: "/test",
    });

    const [error, result, response] = await useRequest(client);

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");
    expect(error?.response?.status).toBe(500);
    expect(error?.message).toContain("500");
    expect(error?.message).toContain("Server Error");
    if (error?.code === "HTTP_STATUS") {
      expect(error.data).toEqual({ code: "ERR" });
    }
  });

  test.each(["abort", "timeout"] as const)(
    "should classify a pre-cancelled interceptor signal as %s without fetching",
    async (mode) => {
      let fetches = 0;
      const guardedClient = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle(() => {
          fetches += 1;
          return Promise.resolve(new Response(null, { status: 204 }));
        }),
        withInterceptors(
          createHttpInterceptor((_request, next) =>
            next({
              ..._request,
              signal: AbortSignal.abort(
                mode === "timeout"
                  ? new DOMException("deadline", "TimeoutError")
                  : "stop",
              ),
            }),
          ),
        ),
      );
      const useRequest = defineRequest({ method: "GET", path: "/preabort" });

      const [error] = await useRequest(guardedClient);

      expect(fetches).toBe(0);
      expect(error?.code).toBe(
        mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
      );
    },
  );

  test("should classify a non-Error interceptor throw as INTERCEPTOR_FAILED", async () => {
    const guardedClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the interceptor under test rejects with a string, which must be classified as INTERCEPTOR_FAILED
        createHttpInterceptor(() => Promise.reject("interceptor boom")),
      ),
    );
    const useRequest = defineRequest({ method: "GET", path: "/intercepted" });

    const [error] = await useRequest(guardedClient);

    expect(error).toMatchObject({
      code: "EXT_INTERCEPTOR_FAILED",
      message: "interceptor boom",
    });
    expect(error).toBeInstanceOf(Error);
  });

  describe("when the interceptor chain does not resolve an HttpResponse", () => {
    const notAnHttpResponse = [
      ...MALFORMED_INTERCEPTOR_RESULTS,
      [
        "an unbranded lookalike",
        () => ({
          body: null,
          headers: new Headers(),
          ok: true,
          status: 200,
          statusText: "",
          url: "",
        }),
      ],
    ] as const;
    const useUndeclared = defineRequest({ method: "GET", path: "/malformed" });
    const useDeclared = defineRequest({
      method: "GET",
      output: struct.null(),
      path: "/malformed",
    });

    test.each(notAnHttpResponse)(
      "should settle with EXT_INTERCEPTOR_FAILED for %s",
      async (_name, resolved) => {
        const guardedClient = createClient(
          withEndpoint("https://example.com"),
          withInterceptors(
            createHttpInterceptor(() =>
              // @ts-expect-error interceptor result is not an HttpResponse
              Promise.resolve(resolved()),
            ),
          ),
        );

        for (const useRequest of [useUndeclared, useDeclared]) {
          const [error, result, response] = await useRequest(guardedClient);

          expect(error).toMatchObject({ code: "EXT_INTERCEPTOR_FAILED" });
          expect(error?.cause).toBeInstanceOf(TypeError);
          expect(result).toBeUndefined();
          expect(response).toBeUndefined();
        }
      },
    );

    test("should accept a response derived from next() by spreading", async () => {
      const guardedClient = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle(() =>
          Promise.resolve(
            new Response("null", {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
        withInterceptors(
          createHttpInterceptor(async (request, next) => ({
            ...(await next(request)),
            status: 201,
          })),
        ),
      );

      const [error, , response] = await useDeclared(guardedClient);

      expect(error).toBeNull();
      expect(response?.status).toBe(201);
    });
  });

  test("should treat an abort inside the builder as NET_ABORTED before transport", async () => {
    const controller = new AbortController();
    let fetched = 0;
    const guardedClient = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => {
        fetched += 1;
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    const useItem = defineRequest({
      builder: () => {
        controller.abort();
        return {};
      },
      method: "GET",
      path: "/item",
    });

    const [error, result, response] = await useItem(
      guardedClient({ signal: controller.signal }),
    );

    expect(error?.code).toBe("NET_ABORTED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(fetched).toBe(0);
  });

  test("should report a caller abort during an interceptor when no body is declared", async () => {
    const controller = new AbortController();
    const guardedClient = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(() => {
          controller.abort();
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );
    const useEmpty = defineRequest({
      method: "GET",
      path: "/empty",
    });

    const [error, result, response] = await useEmpty(
      guardedClient({ signal: controller.signal }),
    );

    expect(error?.code).toBe("NET_ABORTED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
  });
});
