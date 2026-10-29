import { afterEach, describe, expect, test, vi } from "vitest";
import type { HttpRequest } from "../http";
import { makeFakeHandler } from "../../test/make_fake_handler";
import type { EventStreamHandle } from "../sse/transport/event_stream";
import type { BasicCredential } from "./basic_auth";
import {
  basicAuthHttpInterceptor,
  basicAuthSSEInterceptor,
} from "./basic_auth";
import { makeChain } from "./interceptor";

describe("Basic Auth Interceptor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const credential: BasicCredential = {
    username: "user",
    password: "123",
  };

  test("basicAuthHttpInterceptor should set Authorization header", async () => {
    const hq: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "GET",
    };
    const interceptor = basicAuthHttpInterceptor(() => credential);
    const chain = makeChain([interceptor.fn]);
    const requests: HttpRequest[] = [];
    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: "OK",
      },
      onRequestBefore: (req) => {
        requests.push(req);
      },
    });

    await chain(hq, handler);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers).toBeInstanceOf(Headers);
    expect(requests[0]?.headers?.get("Authorization")).toBe(
      "Basic dXNlcjoxMjM=",
    );
    expect(hq.headers).toBeUndefined();
  });

  test("basicAuthHttpInterceptor should not mutate incoming headers", async () => {
    const headers = new Headers({ "x-request-id": "req-1" });
    const hq: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      headers,
      method: "GET",
    };
    const interceptor = basicAuthHttpInterceptor(() => credential);
    const chain = makeChain([interceptor.fn]);
    const requests: HttpRequest[] = [];
    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: "OK",
      },
      onRequestBefore: (req) => {
        requests.push(req);
      },
    });

    await chain(hq, handler);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers).not.toBe(headers);
    expect(requests[0]?.headers?.get("Authorization")).toBe(
      "Basic dXNlcjoxMjM=",
    );
    expect(requests[0]?.headers?.get("x-request-id")).toBe("req-1");
    expect(hq.headers).toBe(headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("x-request-id")).toBe("req-1");
  });

  test("basicAuthHttpInterceptor should accept custom encode", async () => {
    const hq: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/user",
      method: "GET",
    };
    const interceptor = basicAuthHttpInterceptor(() => credential, {
      encode: (data) => `custom:${data.username}:${data.password}`,
    });
    const chain = makeChain([interceptor.fn]);
    const requests: HttpRequest[] = [];
    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: "OK",
      },
      onRequestBefore: (req) => {
        requests.push(req);
      },
    });

    await chain(hq, handler);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers).toBeInstanceOf(Headers);
    expect(requests[0]?.headers?.get("Authorization")).toBe(
      "Basic custom:user:123",
    );
    expect(hq.headers).toBeUndefined();
  });

  test("basicAuthSSEInterceptor should set Authorization header", async () => {
    const hq: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/v1/events",
      method: "GET",
    };
    const interceptor = basicAuthSSEInterceptor(() => credential);
    const chain = makeChain([interceptor.fn]);

    let capturedRequest: HttpRequest | undefined;
    const fakeSSEHandler = async (req: HttpRequest) => {
      capturedRequest = req;
      return {} as EventStreamHandle<unknown>;
    };

    await chain(hq, fakeSSEHandler);

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.headers?.get("Authorization")).toEqual(
      `Basic ${btoa(`${credential.username}:${credential.password}`)}`,
    );
  });

  test("should throw error if btoa is not supported", () => {
    vi.stubGlobal("btoa", undefined);

    expect(() => basicAuthHttpInterceptor(() => credential)).toThrowError();
    expect(() => basicAuthSSEInterceptor(() => credential)).toThrowError();
  });

  test("basicAuthHttpInterceptor should return kind http", () => {
    const interceptor = basicAuthHttpInterceptor(() => credential);
    expect(interceptor.kind).toBe("http");
  });

  test("basicAuthSSEInterceptor should return kind sse", () => {
    const interceptor = basicAuthSSEInterceptor(() => credential);
    expect(interceptor.kind).toBe("sse");
  });
});
