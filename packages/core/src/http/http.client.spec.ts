import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  type FetchHandle,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
} from "../client";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "./http_response";
import { struct } from "../struct";
import { defineRequest } from "./index";

describe("request http runtime with client config", () => {
  test("should support querySerializer from client config", async () => {
    let capturedRequestUrl = "";

    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor((request) => {
          capturedRequestUrl = `${request.endpoint}?${request.query?.toString() ?? ""}`;
          return Promise.resolve(
            makeResponse({
              body: null,
              status: 200,
            }),
          );
        }),
      ),
      withQuerySerializer((query) => {
        return Object.entries(query)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key.toUpperCase()}=${String(value)}`)
          .join("&");
      }),
    );

    const useSerializedQuery = defineRequest({
      builder: (input) => ({ query: input }),
      input: struct.object({ a: struct.string(), b: struct.string() }),
      method: "GET",
      path: "/query",
    });

    const [error] = await useSerializedQuery(client, { a: "1", b: "2" });

    expect(error).toBeNull();
    expect(capturedRequestUrl).toBe("/query?A=1&B=2");
  });

  test("should use client http handle after interceptors", async () => {
    const fetchMock = vi.fn<FetchHandle>((input) => {
      if (!(input instanceof Request))
        return Promise.reject(new Error("expected Request"));
      const request = input;
      expect(request.url).toBe("https://example.com/query?A=1&B=2");
      return Promise.resolve(
        new Response(null, {
          status: 200,
        }),
      );
    });
    let interceptorCalls = 0;

    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          interceptorCalls += 1;
          return await next(request);
        }),
      ),
      withHTTPHandle(fetchMock),
      withQuerySerializer((query) => {
        return Object.entries(query)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key.toUpperCase()}=${String(value)}`)
          .join("&");
      }),
    );

    const useSerializedQuery = defineRequest({
      builder: (input) => ({ query: input }),
      input: struct.object({ a: struct.string(), b: struct.string() }),
      method: "GET",
      path: "/query",
    });

    const [error] = await useSerializedQuery(client, { a: "1", b: "2" });

    expect(error).toBeNull();
    expect(interceptorCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("should keep the HTTP definition when the caller mutates the configuration object", async () => {
    const definition: { method: "GET"; path: string } = {
      method: "GET",
      path: "/first",
    };
    const first = defineRequest(definition);
    definition.path = "/second";
    const second = defineRequest(definition);
    const paths: string[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor((request) => {
          paths.push(request.endpoint);
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );

    expect((await first(client))[0]).toBeNull();
    expect((await second(client))[0]).toBeNull();
    expect(paths).toEqual(["/first", "/second"]);
  });

  test("handles empty endpoints, invalid input, FormData with default headers, and direct text/serialized query", async () => {
    const emptyClient = createClient();
    const ping = defineRequest({ method: "GET", path: "/ping" });
    const [emptyErr] = await ping(emptyClient);
    expect(emptyErr?.code).toBe("REQ_BUILD_FAILED");

    const controller = new AbortController();
    const [guardedEmptyErr] = await ping(
      emptyClient({ signal: controller.signal }),
    );
    expect(guardedEmptyErr?.code).toBe("REQ_BUILD_FAILED");

    const withInput = defineRequest({
      method: "GET",
      path: "/items/:id",
      input: struct.object({ id: struct.string() }),
      builder: (input) => ({ path: { id: input.id } }),
    });
    const directClient = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      ),
    );
    const [inputErr] = await withInput(directClient, {
      // @ts-expect-error passing a number exercises REQ_INPUT_INVALID on direct HTTP preflight
      id: 123,
    });
    expect(inputErr?.code).toBe("REQ_INPUT_INVALID");

    const seenRequests: Request[] = [];
    const headerClient = createClient(
      withEndpoint("https://example.test"),
      (config) => {
        config.headers = new Headers({
          "content-type": "multipart/form-data",
          "x-client": "1",
        });
      },
      withHTTPHandle((input) => {
        if (input instanceof Request) {
          seenRequests.push(input);
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );

    const uploadForm = defineRequest({
      method: "POST",
      path: "/upload",
      input: struct.unknown(),
      builder: () => {
        const form = new FormData();
        form.set("field", "value");
        return { body: form };
      },
    });

    const [formErr] = await uploadForm(headerClient, {});
    expect(formErr).toBeNull();
    expect(seenRequests[0]?.headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(seenRequests[0]?.headers.get("x-client")).toBe("1");
  });
});
