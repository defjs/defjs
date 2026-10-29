import { beforeEach, describe, expect, inject, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withInterceptors,
  withXSRF,
} from "../client";
import type { Client } from "../client";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "../internal/http_response";
import { struct } from "../struct";
import type { HttpRequest } from "./index";
import { defineRequest } from "./index";

describe("request http runtime", () => {
  let client: Client;

  beforeEach(() => {
    client = createClient(withEndpoint(inject("testServerHost")));
  });

  test("should resolve success tuple for object-style request endpoints", async () => {
    const useCreateAccount = defineRequest({
      method: "POST",
      output: struct.object({
        id: struct.number(),
        name: struct.string(),
      }),
      path: "/account",
    });

    const [error, result, response] = await client.execute(useCreateAccount());

    expect(error).toBeNull();
    expect(result).toEqual({ id: 1, name: "Jack" });
    expect(response?.ok).toBe(true);
    expect(response?.status).toBe(200);
  });

  test("should decode any non-2xx body with the declared error struct", async () => {
    const useMissingAccount = defineRequest({
      method: "GET",
      error: struct.object({
        code: struct.string(),
        message: struct.string(),
      }),
      path: "/account/not-found",
    });

    const [error, result, response] = await client.execute(useMissingAccount());

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("HTTP_STATUS");

    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }

    expect(error.status).toBe(404);
    expect(error.response.status).toBe(404);
    expect(error.data).toEqual({
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found",
    });
  });

  test("should encode request aliases and decode response aliases through a real round-trip", async () => {
    const useUser = defineRequest({
      builder: (input) => ({ body: input }),
      input: struct.object({
        name: struct.string().alias("user_name"),
      }),
      method: "POST",
      output: struct.object({
        name: struct.string().alias("user_name"),
      }),
      path: "/json/alias",
    });

    const [error, result] = await client.execute(useUser({ name: "Miao" }));

    expect(error).toBeNull();
    expect(result).toEqual({ name: "Miao" });
  });

  test("should round-trip a custom build bound view through the real test server", async () => {
    const useEcho = defineRequest({
      builder: (input) => ({ body: input }),
      input: struct.object({
        name: struct.string().alias("user_name"),
      }),
      method: "POST",
      output: struct.object({
        name: struct.string().alias("user_name"),
      }),
      path: "/",
    });

    const [error, result] = await client.execute(useEcho({ name: "Miao" }));

    expect(error).toBeNull();
    expect(result).toEqual({ name: "Miao" });
  });

  test("should send nothing for optional input objects the caller omits", async () => {
    let capturedRequest: HttpRequest | undefined;
    const optionalClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          capturedRequest = request;
          return makeResponse({ status: 200 });
        }),
      ),
    );
    const useOptionalObjects = defineRequest({
      builder: (input) => ({
        headers: input.trace,
        query: input.paging,
      }),
      input: struct.object({
        paging: struct.object({ page: struct.number().optional() }).optional(),
        trace: struct
          .object({ traceId: struct.string().optional() })
          .optional(),
      }),
      method: "GET",
      path: "/search",
    });

    const [error] = await optionalClient.execute(useOptionalObjects({}));

    expect(error).toBeNull();
    expect(capturedRequest?.endpoint).toBe("/search");
    expect(capturedRequest?.queryString).toBe("");
    expect(Array.from(capturedRequest?.headers?.entries() ?? [])).toEqual([]);
  });

  test("should build params query headers and body, and only execute once per ref", async () => {
    let callCount = 0;
    let capturedRequest: HttpRequest | undefined;

    const client = createClient(
      withEndpoint("https://example.com/api"),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          callCount += 1;
          capturedRequest = request as typeof capturedRequest;
          return makeResponse({
            body: {
              ok: true,
            },
            headers: new Headers({ "content-type": "application/json" }),
            status: 200,
          });
        }),
      ),
    );

    const useInspectRequest = defineRequest({
      builder: (input) => ({
        body: {
          nickname: input.nickname,
        },
        headers: {
          "x-token": input.token,
        },
        path: {
          id: input.id,
        },
        query: {
          include: input.include,
          tags: input.tags,
        },
      }),
      input: struct.object({
        id: struct.number(),
        include: struct.boolean(),
        nickname: struct.string(),
        tags: struct.array(struct.string()),
        token: struct.string(),
      }),
      method: "POST",
      output: struct.object({
        ok: struct.boolean(),
      }),
      path: "/inspect/:id",
    });

    const command = useInspectRequest({
      id: 7,
      include: true,
      nickname: "Miao",
      tags: ["a", "b"],
      token: "secret",
    });

    const [[firstError, firstResult], [secondError, secondResult]] =
      await Promise.all([client.execute(command), client.execute(command)]);

    expect(firstError).toBeNull();
    expect(secondError).toBeNull();
    expect(firstResult).toEqual({ ok: true });
    expect(secondResult).toEqual({ ok: true });
    expect(callCount).toBe(2);
    expect(capturedRequest?.baseEndpoint).toBe("https://example.com/api");
    expect(capturedRequest?.endpoint).toBe("/inspect/7");
    expect(capturedRequest?.queryParams?.get("include")).toBe("true");
    expect(capturedRequest?.queryParams?.getAll("tags")).toEqual(["a", "b"]);
    expect(capturedRequest?.headers?.get("x-token")).toBe("secret");
    expect(capturedRequest?.body).toBe('{"nickname":"Miao"}');
  });

  test("should encode a raw path value as one segment", async () => {
    let endpoint: string | undefined;
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          endpoint = request.endpoint;
          return makeResponse({ status: 204 });
        }),
      ),
    );
    const useUser = defineRequest({
      builder: (input) => ({ path: input }),
      input: struct.object({ id: struct.string() }),
      method: "GET",
      path: "/users/:id",
    });

    const [error] = await client.execute(useUser({ id: "a/b ?#%猫" }));

    expect(error).toBeNull();
    expect(endpoint).toBe("/users/a%2Fb%20%3F%23%25%E7%8C%AB");
  });

  test("should expose xsrf client config on the final HttpRequest", async () => {
    const tokenProvider = () => "xsrf-token";
    let capturedRequest: HttpRequest | undefined;

    const client = createClient(
      withEndpoint("https://example.com/api"),
      withXSRF({
        cookieName: "CUSTOM-XSRF-TOKEN",
        headerName: "X-CUSTOM-XSRF-TOKEN",
        tokenProvider,
      }),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          capturedRequest = request as typeof capturedRequest;
          return makeResponse({
            body: {
              ok: true,
            },
            headers: new Headers({ "content-type": "application/json" }),
            status: 200,
          });
        }),
      ),
    );

    const useInspectXsrf = defineRequest({
      method: "GET",
      output: struct.object({
        ok: struct.boolean(),
      }),
      path: "/xsrf",
    });

    const [error, result] = await client.execute(useInspectXsrf());

    expect(error).toBeNull();
    expect(result).toEqual({ ok: true });
    expect(capturedRequest?.xsrf).toEqual({
      cookieName: "CUSTOM-XSRF-TOKEN",
      headerName: "X-CUSTOM-XSRF-TOKEN",
      tokenProvider,
    });
  });

  test("should return definition error when build is provided without input struct", async () => {
    const useRawInput = defineRequest({
      builder: () => {
        throw new Error("build failed");
      },
      method: "GET",
      path: "/raw-input",
    });

    const [error, result, response] = await client.execute(useRawInput());

    expect(error?.code).toBe("REQ_BUILD_FAILED");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
  });

  test("should ignore response body when output is omitted", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: {
              ignored: true,
            },
            status: 200,
          }),
        ),
      ),
    );

    const useIgnoredOutput = defineRequest({
      method: "GET",
      path: "/ignored-output",
    });

    const [error, result, response] = await client.execute(useIgnoredOutput());

    expect(error).toBeNull();
    expect(result).toBeUndefined();
    expect(response?.status).toBe(200);
    // Philosophy 5: with no `output` declared the body is never read, so there is no body field.
    expect(response).not.toHaveProperty("body");
  });

  test("should return http error when output is omitted and response is not ok", async () => {
    const useNoOutput = defineRequest({
      method: "GET",
      path: "/500",
    });

    const [error, result, response] = await client.execute(useNoOutput());

    expect(error?.code).toBe("HTTP_STATUS");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();

    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }

    expect(error.status).toBe(500);
    expect(error.data).toBeUndefined();
    // Philosophy 5: with no `error` declared the body is never read.
    expect(error.response).not.toHaveProperty("body");
  });
});
