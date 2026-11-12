import { afterEach, describe, expect, test, vi } from "vitest";
import type { HttpRequest } from "../../http";
import {
  createFetchRequest,
  createFetchRequestInit,
  fetchHandler,
} from "./fetch";
import {
  __resetStreamingRequestBodySupportForTests,
  supportsStreamingRequestBody,
} from "./fetch_init";
import { isBodyFailure } from "./body_failure";
import { PLATFORM_FETCH_HANDLE } from "../../client/config";
import type { FetchHandle } from "../../client/config";

function headersOf(init: RequestInit): Headers {
  if (init.headers instanceof Headers) return init.headers;
  throw new Error("expected Headers");
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetStreamingRequestBodySupportForTests();
});

describe("Fetch handler request creation", () => {
  test("should create a request", async () => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    const body = { id: 1 };
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      headers,
      body: { id: 1 },
      withCredentials: true,
    };
    const request = createFetchRequest(requestConfig);
    const init = createFetchRequestInit(requestConfig);

    expect(request.url).toEqual(
      new URL(requestConfig.endpoint, requestConfig.baseEndpoint).toString(),
    );
    expect(await request.json()).toEqual(body);
    expect(request.headers.get("Content-Type")).toEqual("application/json");
    expect(request.method).toEqual("POST");
    expect(init.credentials).toEqual("include");
    if (request.credentials !== undefined) {
      expect(request.credentials).toEqual("include");
    }
  });

  test("should add url search", () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "GET",
      queryParams: new URLSearchParams({ id: "1" }),
    };

    const { url } = createFetchRequest(requestConfig);
    const { searchParams } = new URL(url);
    expect(searchParams.get("id")).toEqual("1");
  });

  test("should add content type when header not set", () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      body: {
        id: 1,
      },
    };

    const request = createFetchRequest(requestConfig);
    expect(request.headers.get("Content-Type")).toEqual("application/json");
  });

  test("should keep a configured content-type header over body detection and bodyContentType", () => {
    const jsonBody = { id: 1 };
    const jsonRequest: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      headers: new Headers([["Content-Type", "text/plain"]]),
      method: "POST",
      body: jsonBody,
    };

    const serializedJson = '{"id":1}';
    const builderRequest: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      headers: new Headers([["Content-Type", "text/plain"]]),
      method: "POST",
      body: serializedJson,
      bodyContentType: "application/json",
      bodyContentTypeSource: serializedJson,
    };

    const binaryRequest: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/upload",
      headers: new Headers([["Content-Type", "text/plain"]]),
      method: "POST",
      body: new ArrayBuffer(0),
    };

    expect(
      headersOf(createFetchRequestInit(jsonRequest)).get("content-type"),
    ).toBe("text/plain");
    expect(
      headersOf(createFetchRequestInit(builderRequest)).get("content-type"),
    ).toBe("text/plain");
    expect(
      headersOf(createFetchRequestInit(binaryRequest)).get("content-type"),
    ).toBe("text/plain");
  });

  test("should remove or suppress Content-Type from final body rules", () => {
    const formDataRequest: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/upload",
      headers: new Headers([["Content-Type", "multipart/form-data"]]),
      method: "POST",
      body: new FormData(),
    };

    const textBody = "hello";
    const suppressedRequest: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/text",
      method: "POST",
      body: textBody,
      bodyContentType: null,
      bodyContentTypeSource: textBody,
    };

    expect(
      headersOf(createFetchRequestInit(formDataRequest)).has("content-type"),
    ).toBe(false);
    expect(
      headersOf(createFetchRequestInit(suppressedRequest)).has("content-type"),
    ).toBe(false);
  });

  test("should reject requests without baseEndpoint", () => {
    const requestConfig: HttpRequest = {
      endpoint: "/v1/user",
      method: "GET",
    };

    expect(() => createFetchRequest(requestConfig)).toThrowError(
      "Client endpoint is required",
    );
  });

  test("should reject requests with invalid baseEndpoint", () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: "/api",
      endpoint: "/v1/user",
      method: "GET",
    };

    expect(() => createFetchRequest(requestConfig)).toThrowError(
      "Client endpoint must be a valid URL",
    );
  });

  test("should return false when ReadableStream is undefined", () => {
    vi.stubGlobal("ReadableStream", undefined);
    expect(supportsStreamingRequestBody()).toBe(false);
  });

  test("should handle fetch network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Network request failed"))),
    );

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "GET",
    };

    await expect(fetchHandler(requestConfig)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("finalizeHeaders failure", () => {
  const cause = new TypeError("token unavailable");
  const request: HttpRequest = {
    baseEndpoint: "https://example.com",
    endpoint: "/v1/user",
    finalizeHeaders: () => {
      throw cause;
    },
    method: "POST",
  };

  function expectHookFailure(rejection: unknown): void {
    expect(isBodyFailure(rejection)).toBe(true);
    expect(isBodyFailure(rejection) && rejection.code).toBe("EXT_HOOK_FAILED");
    expect(rejection instanceof Error && rejection.cause).toBe(cause);
  }

  test("rejects with a tagged hook failure before the platform fetch runs", async () => {
    // The platform fast path is the untouched global, so it cannot be spied on; a rejection from the hook means fetch never started.
    expectHookFailure(
      await fetchHandler(request, PLATFORM_FETCH_HANDLE).catch(
        (error: unknown) => error,
      ),
    );
  });

  test("rejects with a tagged hook failure before a custom handle is called", async () => {
    const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

    expectHookFailure(
      await fetchHandler(request, handle).catch((error: unknown) => error),
    );
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("request construction failure", () => {
  const base: HttpRequest = {
    baseEndpoint: "https://example.com",
    endpoint: "/v1/user",
    method: "POST",
  };

  async function rejection(
    request: HttpRequest,
    handle: FetchHandle | undefined,
  ): Promise<unknown> {
    return await fetchHandler(request, handle).catch((error: unknown) => error);
  }

  function expectBuildFailure(rejected: unknown): void {
    expect(isBodyFailure(rejected)).toBe(true);
    expect(isBodyFailure(rejected) && rejected.code).toBe("REQ_BUILD_FAILED");
    expect(rejected instanceof Error && rejected.cause).toBeInstanceOf(
      TypeError,
    );
  }

  test.each([
    ["GET", "payload"],
    ["head", "payload"],
    ["TRACE", undefined],
    ["connect", undefined],
    ["Track", undefined],
  ])(
    "%s with body %j is rejected before a custom handle is called",
    async (method, body) => {
      const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

      expectBuildFailure(await rejection({ ...base, method, body }, handle));
      expect(handle).not.toHaveBeenCalled();
    },
  );

  test("an omitted method is read as GET, so a body is rejected before a custom handle is called", async () => {
    const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

    expectBuildFailure(
      await rejection(
        // @ts-expect-error JavaScript callers may omit the required method
        { ...base, method: undefined, body: "payload" },
        handle,
      ),
    );
    expect(handle).not.toHaveBeenCalled();
  });

  test("an omitted method without a body is still sent as GET", async () => {
    const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

    const response = await fetchHandler(
      // @ts-expect-error JavaScript callers may omit the required method
      { ...base, method: undefined },
      handle,
    );

    expect(response.status).toBe(200);
    expect(handle.mock.calls[0]?.[0]).toMatchObject({ method: "GET" });
  });

  test.each(["BAD METHOD", ""])(
    "the method %j is rejected before a custom handle is called",
    async (method) => {
      const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

      expectBuildFailure(await rejection({ ...base, method }, handle));
      expect(handle).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["a user name", "https://user@example.com"],
    ["a password", "https://:pw@example.com"],
  ])(
    "a URL with %s is rejected before a custom handle is called",
    async (_label, baseEndpoint) => {
      const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

      expectBuildFailure(await rejection({ ...base, baseEndpoint }, handle));
      expect(handle).not.toHaveBeenCalled();
    },
  );

  test("the platform fast path rejects a URL with credentials the same way", async () => {
    expectBuildFailure(
      await rejection(
        { ...base, baseEndpoint: "https://user:pw@example.com" },
        PLATFORM_FETCH_HANDLE,
      ),
    );
  });

  test("the platform fast path rejects a GET body the same way", async () => {
    expectBuildFailure(
      await rejection(
        { ...base, method: "GET", body: "payload" },
        PLATFORM_FETCH_HANDLE,
      ),
    );
  });

  test.each(["a\r\nX-Evil: 1", "a\u0000b", "\u20ac"])(
    "bodyContentType %j is rejected before a custom handle is called",
    async (bodyContentType) => {
      const handle = vi.fn<FetchHandle>(() => Promise.resolve(new Response()));

      expectBuildFailure(
        await rejection({ ...base, body: "payload", bodyContentType }, handle),
      );
      expect(handle).not.toHaveBeenCalled();
    },
  );
});
