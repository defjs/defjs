import { afterEach, describe, expect, test, vi } from "vitest";
import type { HttpRequest } from "../../http";
import {
  __resetStreamingRequestBodySupportForTests,
  createFetchRequest,
  createFetchRequestInit,
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  fetchHandler,
  supportsStreamingRequestBody,
} from "./fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetStreamingRequestBodySupportForTests();
});

function stubXsrfBrowserEnvironment(origin: string, cookieValue: string) {
  const cookieGetter = vi.fn(() => cookieValue);
  const documentStub = {} as { [key: string]: unknown };

  vi.stubGlobal("location", { origin });
  vi.stubGlobal("document", documentStub);

  Object.defineProperty(documentStub, "cookie", {
    configurable: true,
    get: cookieGetter,
  });

  return { cookieGetter };
}

type XSRFConfig = {
  cookieName: string;
  headerName: string;
  tokenProvider?: (context: {
    request: HttpRequest;
  }) => string | null | undefined;
};

function createXsrfConfig(
  tokenProvider?: XSRFConfig["tokenProvider"],
): XSRFConfig {
  return {
    cookieName: "XSRF-TOKEN",
    headerName: "X-XSRF-TOKEN",
    tokenProvider,
  };
}

describe("Fetch handler XSRF injection", () => {
  test("should inject xsrf header for mutating same-origin requests from cookie", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).get("X-XSRF-TOKEN")).toBe("cookie-token");
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test("should inject xsrf header when same-origin request uses withCredentials", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      withCredentials: true,
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect(init.credentials).toBe("include");
    expect((init.headers as Headers).get("X-XSRF-TOKEN")).toBe("cookie-token");
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test.each(["GET", "HEAD", "OPTIONS", "TRACE"] as const)(
    "should not inject xsrf header for safe %s requests",
    (method) => {
      const { cookieGetter } = stubXsrfBrowserEnvironment(
        "https://example.com",
        "XSRF-TOKEN=cookie-token",
      );
      const requestConfig: HttpRequest = {
        baseEndpoint: "https://example.com",
        endpoint: "/v1/user",
        method,
        xsrf: createXsrfConfig(),
      };

      const init = createFetchRequestInit(requestConfig);

      expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
      expect(cookieGetter).not.toHaveBeenCalled();
    },
  );

  test("should inject xsrf header for custom unsafe methods", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/resource",
      method: "PROPPATCH",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).get("X-XSRF-TOKEN")).toBe("cookie-token");
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test("should not inject xsrf header for cross-origin requests", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://api.example.com",
      endpoint: "/v1/user",
      method: "POST",
      withCredentials: true,
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(cookieGetter).not.toHaveBeenCalled();
  });

  test("should not inject xsrf header when browser cookie is empty", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test("should not inject xsrf header when browser cookie name does not match", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "OTHER-TOKEN=other-token",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test("should not inject xsrf header when baseEndpoint is missing", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const requestConfig: HttpRequest = {
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(cookieGetter).not.toHaveBeenCalled();
  });

  test("should not inject xsrf header when tokenProvider returns null", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const tokenProvider = vi.fn(() => null);
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(tokenProvider),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(tokenProvider).toHaveBeenCalledWith({ request: requestConfig });
    expect(cookieGetter).not.toHaveBeenCalled();
  });

  test("should not inject xsrf header when tokenProvider returns empty string", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const tokenProvider = vi.fn(() => "");
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(tokenProvider),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(tokenProvider).toHaveBeenCalledWith({ request: requestConfig });
    expect(cookieGetter).not.toHaveBeenCalled();
  });

  test("should not inject xsrf header when browser cookie value is empty", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=",
    );
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test("should not inject xsrf header when browser cookie access throws", () => {
    const cookieGetter = vi.fn(() => {
      throw new Error("cookie unavailable");
    });
    const documentStub = {} as { [key: string]: unknown };

    vi.stubGlobal("location", { origin: "https://example.com" });
    vi.stubGlobal("document", documentStub);

    Object.defineProperty(documentStub, "cookie", {
      configurable: true,
      get: cookieGetter,
    });

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(cookieGetter).toHaveBeenCalledTimes(1);
  });

  test("should prefer tokenProvider over cookie", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const tokenProvider = vi.fn(() => "provider-token");
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(tokenProvider),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).get("X-XSRF-TOKEN")).toBe(
      "provider-token",
    );
    expect(tokenProvider).toHaveBeenCalledWith({ request: requestConfig });
    expect(cookieGetter).not.toHaveBeenCalled();
  });

  test("should not override an existing xsrf header", () => {
    const { cookieGetter } = stubXsrfBrowserEnvironment(
      "https://example.com",
      "XSRF-TOKEN=cookie-token",
    );
    const tokenProvider = vi.fn(() => "provider-token");
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      headers: new Headers([["X-XSRF-TOKEN", "existing-token"]]),
      method: "POST",
      xsrf: createXsrfConfig(tokenProvider),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).get("X-XSRF-TOKEN")).toBe(
      "existing-token",
    );
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(cookieGetter).not.toHaveBeenCalled();
  });

  test("should not inject xsrf header in non-browser runtime without provider", () => {
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("document", undefined);

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).has("X-XSRF-TOKEN")).toBe(false);
  });

  test("should inject xsrf header in non-browser runtime with provider", () => {
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("document", undefined);

    const tokenProvider = vi.fn(() => "provider-token");
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "POST",
      xsrf: createXsrfConfig(tokenProvider),
    };

    const init = createFetchRequestInit(requestConfig);

    expect((init.headers as Headers).get("X-XSRF-TOKEN")).toBe(
      "provider-token",
    );
    expect(tokenProvider).toHaveBeenCalledWith({ request: requestConfig });
  });
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
      (createFetchRequestInit(jsonRequest).headers as Headers).get(
        "content-type",
      ),
    ).toBe("text/plain");
    expect(
      (createFetchRequestInit(builderRequest).headers as Headers).get(
        "content-type",
      ),
    ).toBe("text/plain");
    expect(
      (createFetchRequestInit(binaryRequest).headers as Headers).get(
        "content-type",
      ),
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
      (createFetchRequestInit(formDataRequest).headers as Headers).has(
        "content-type",
      ),
    ).toBe(false);
    expect(
      (createFetchRequestInit(suppressedRequest).headers as Headers).has(
        "content-type",
      ),
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

  test("should auto set duplex half for ReadableStream body", () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/stream",
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
    };

    if (!supportsStreamingRequestBody()) {
      expect(() => createFetchRequest(requestConfig)).toThrow(
        ERR_STREAMING_REQUEST_UNSUPPORTED,
      );
      return;
    }

    const init = createFetchRequestInit(requestConfig);
    expect(init.duplex).toBe("half");
  });

  test.each([
    { contentLength: "-1", total: 0 },
    { contentLength: "not-a-number", total: 0 },
    { contentLength: "Infinity", total: 0 },
    { contentLength: "100", total: 100 },
    { contentLength: undefined, total: 0 },
    { contentLength: "0", total: 0 },
  ])(
    "should count upload bytes with Content-Length $contentLength",
    async ({ contentLength, total }) => {
      const events: Array<{
        lengthComputable: boolean;
        loaded: number;
        total: number;
      }> = [];
      const requestConfig: HttpRequest = {
        baseEndpoint: "https://example.com",
        endpoint: "/v1/user",
        headers: new Headers(
          contentLength === undefined
            ? {}
            : { "Content-Length": contentLength },
        ),
        method: "POST",
        uploadProgress(event) {
          events.push(event);
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.close();
          },
        }),
      };

      expect(supportsStreamingRequestBody()).toBe(true);
      const init = createFetchRequestInit(requestConfig);
      expect(init.duplex).toBe("half");
      expect(await new Response(init.body).text()).toBe("hello");
      expect(events).toEqual([
        { lengthComputable: total > 0, loaded: 5, total },
      ]);
    },
  );

  test("should return false when ReadableStream is undefined", () => {
    vi.stubGlobal("ReadableStream", undefined);
    expect(supportsStreamingRequestBody()).toBe(false);
  });

  test("should handle fetch network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    );

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "GET",
    };

    await expect(fetchHandler(requestConfig)).rejects.toBeInstanceOf(TypeError);
  });

  test("should handle upload progress stream cancel", async () => {
    if (!supportsStreamingRequestBody()) {
      return;
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/upload",
      method: "POST",
      body: stream,
      uploadProgress: vi.fn(),
    };

    const init = createFetchRequestInit(requestConfig);
    const wrappedStream = init.body as ReadableStream<Uint8Array>;
    const reader = wrappedStream.getReader();

    // Read one chunk
    const { value } = await reader.read();
    expect(value).toBeDefined();

    // Cancel the stream
    await reader.cancel("test-cancel");
  });

  test("should propagate upload progress stream read errors", async () => {
    if (!supportsStreamingRequestBody()) {
      return;
    }

    const error = new Error("source failed");
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw error;
      },
    });

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/upload",
      method: "POST",
      body: stream,
      uploadProgress: vi.fn(),
    };

    const init = createFetchRequestInit(requestConfig);
    const wrappedStream = init.body as ReadableStream<Uint8Array>;
    const reader = wrappedStream.getReader();

    await expect(reader.read()).rejects.toThrow("source failed");
  });
});
