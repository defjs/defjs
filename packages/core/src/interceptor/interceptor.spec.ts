import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../http";
import { createFetchRequestInit } from "../http/transport/fetch";
import { makeFakeHandler } from "../../test/make_fake_handler";
import type { InterceptorFn } from "../interceptor/interceptor";
import { createHttpInterceptor, makeChain } from "../interceptor/interceptor";
import { makeResponse } from "../internal/http_response";

describe("interceptor", () => {
  it("should work with InterceptorFn chain", async () => {
    const result: number[] = [];
    const fun1: InterceptorFn = (req, next) => {
      result.push(1);
      return next(req).then((r) => {
        result.push(1.1);
        return r;
      });
    };

    const fun2: InterceptorFn = (req, next) => {
      result.push(2);
      return next(req).then((r) => {
        result.push(2.1);
        return r;
      });
    };

    const fun3: InterceptorFn = (req, next) => {
      result.push(3);
      return next(req).then((r) => {
        result.push(3.1);
        return r;
      });
    };

    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        body: "Hello World",
      },
    });
    const chain = makeChain([fun1, fun2, fun3]);
    const req: HttpRequest = {
      baseEndpoint: "https://api.github.com",
      method: "GET",
      endpoint: "/user",
    };

    await chain(req, handler);

    expect(result).toEqual([1, 2, 3, 3.1, 2.1, 1.1]);
  });

  it("should allow interceptor to skip next and return makeResponse", async () => {
    let handlerCalled = false;
    const interceptor: InterceptorFn = async () =>
      makeResponse({
        body: null,
        status: 200,
      });
    const chain = makeChain([interceptor]);
    const response = await chain(
      {
        baseEndpoint: "https://api.example.com",
        method: "GET",
        endpoint: "/cached",
      },
      makeFakeHandler({
        onRequestBefore() {
          handlerCalled = true;
        },
        response: {
          status: 500,
          statusText: "ERR",
          headers: new Headers(),
          body: "nope",
        },
      }),
    );

    expect(handlerCalled).toBe(false);
    expect(response.status).toBe(200);
  });

  it("should create HttpInterceptor with createHttpInterceptor", () => {
    const interceptor = createHttpInterceptor((req, next) => next(req));
    expect(interceptor.kind).toBe("http");
    expect(typeof interceptor.fn).toBe("function");
  });

  it("should preserve body content type metadata when interceptor keeps the body", async () => {
    const body = '{"ok":true}';
    let finalHeaders: Headers | undefined;
    const interceptors: InterceptorFn[] = [
      (req, next) =>
        next({
          ...req,
          headers: new Headers(req.headers),
        }),
    ];
    const chain = makeChain(interceptors);

    await chain(
      {
        baseEndpoint: "https://api.example.com",
        method: "POST",
        endpoint: "/test",
        headers: new Headers(),
        body,
        bodyContentType: "application/json",
        bodyContentTypeSource: body,
      },
      makeFakeHandler({
        onRequestBefore(req) {
          finalHeaders = createFetchRequestInit(req).headers as Headers;
        },
      }),
    );

    expect(finalHeaders?.get("content-type")).toBe("application/json");
  });

  it("should ignore stale body content type metadata when interceptor replaces the body", async () => {
    const oldBody = '{"ok":true}';
    let finalHeaders: Headers | undefined;
    const interceptors: InterceptorFn[] = [
      (req, next) =>
        next({
          ...req,
          body: "plain",
        }),
    ];
    const chain = makeChain(interceptors);

    await chain(
      {
        baseEndpoint: "https://api.example.com",
        method: "POST",
        endpoint: "/test",
        headers: new Headers(),
        body: oldBody,
        bodyContentType: "application/json",
        bodyContentTypeSource: oldBody,
      },
      makeFakeHandler({
        onRequestBefore(req) {
          finalHeaders = createFetchRequestInit(req).headers as Headers;
        },
      }),
    );

    expect(finalHeaders?.get("content-type")).toBe("text/plain;charset=UTF-8");
  });

  it("should remove stale content type when interceptor replaces the body with FormData", async () => {
    const oldBody = '{"ok":true}';
    let finalHeaders: Headers | undefined;
    const interceptors: InterceptorFn[] = [
      (req, next) =>
        next({
          ...req,
          body: new FormData(),
        }),
    ];
    const chain = makeChain(interceptors);

    await chain(
      {
        baseEndpoint: "https://api.example.com",
        method: "POST",
        endpoint: "/test",
        headers: new Headers([["content-type", "application/json"]]),
        body: oldBody,
        bodyContentType: "application/json",
        bodyContentTypeSource: oldBody,
      },
      makeFakeHandler({
        onRequestBefore(req) {
          finalHeaders = createFetchRequestInit(req).headers as Headers;
        },
      }),
    );

    expect(finalHeaders?.has("content-type")).toBe(false);
  });
});
