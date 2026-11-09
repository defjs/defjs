import { afterEach, describe, expect, test, vi } from "vitest";
import type { HttpRequest } from "../../http";
import {
  __resetStreamingRequestBodySupportForTests,
  createFetchRequest,
  createFetchRequestInit,
  fetchHandler,
  supportsStreamingRequestBody,
} from "./fetch";

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

describe("upload progress without a serialized FormData stream", () => {
  test("sends the FormData unchanged and reports no upload progress", async () => {
    const PlatformResponse = Response;
    class StreamlessResponse extends PlatformResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body instanceof FormData ? null : body, init);
      }
    }
    const form = new FormData();
    form.append("name", "miao");
    const sent: (string | null)[] = [];
    const handle = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = new Request(input, init);
      sent.push(request.headers.get("content-type"));
      await request.arrayBuffer();
      return new PlatformResponse(null, { status: 204 });
    };
    const uploadProgress = vi.fn();
    vi.stubGlobal("Response", StreamlessResponse);

    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        body: form,
        endpoint: "/v1/upload",
        method: "POST",
        uploadProgress,
      },
      handle,
    );

    expect(response.status).toBe(204);
    expect(uploadProgress).not.toHaveBeenCalled();
    expect(sent).toEqual([expect.stringContaining("multipart/form-data")]);
  });
});
