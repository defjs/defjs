import { describe, expect, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../client";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "../internal/http_response";
import { StructError, struct } from "../struct";
import type { StructLike } from "../struct";
import { defineRequest } from "./index";

const JSON_HEADERS = { "content-type": "application/json" };
const TEXT_HEADERS = { "content-type": "text/plain" };
const BYTES_HEADERS = { "content-type": "application/octet-stream" };

function clientReturning(
  body: BodyInit | null,
  status: number,
  headers: Record<string, string>,
) {
  return createClient(
    withEndpoint("https://example.com"),
    withHTTPHandle(async () => new Response(body, { headers, status })),
  );
}

describe("inbound representation by struct kind", () => {
  test("should read a string output as raw text", async () => {
    const client = clientReturning("zen-kit", 200, TEXT_HEADERS);
    const useRequest = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/raw",
    });

    const [error, result] = await client.execute(useRequest());

    expect(error).toBeNull();
    expect(result).toBe("zen-kit");
  });

  test("should keep a JSON string body raw when the output struct is a string", async () => {
    const client = clientReturning('"abc"', 200, JSON_HEADERS);
    const useRequest = defineRequest({
      method: "GET",
      output: struct.string(),
      path: "/raw",
    });

    const [error, result] = await client.execute(useRequest());

    expect(error).toBeNull();
    expect(result).toBe('"abc"');
  });

  test("should read a blob output as a Blob", async () => {
    const client = clientReturning(
      new Uint8Array([1, 2, 3]),
      200,
      BYTES_HEADERS,
    );
    const useRequest = defineRequest({
      method: "GET",
      output: struct.blob(),
      path: "/file",
    });

    const [error, result] = await client.execute(useRequest());

    expect(error).toBeNull();
    expect(result).toBeInstanceOf(Blob);
    await expect((result as Blob).arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
  });

  test("should read an arrayBuffer output as bytes", async () => {
    const client = clientReturning(
      new Uint8Array([1, 2, 3]),
      200,
      BYTES_HEADERS,
    );
    const useRequest = defineRequest({
      method: "GET",
      output: struct.arrayBuffer(),
      path: "/bytes",
    });

    const [error, result] = await client.execute(useRequest());

    expect(error).toBeNull();
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  test("should read object, number, and boolean outputs as JSON", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(async (input) => {
        const href = input instanceof Request ? input.url : String(input);
        const pathname = new URL(href).pathname;
        const body =
          pathname === "/num"
            ? "7"
            : pathname === "/flag"
              ? "true"
              : JSON.stringify({ id: 1 });
        return new Response(body, { headers: JSON_HEADERS, status: 200 });
      }),
    );
    const useObject = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/json",
    });
    const useNumber = defineRequest({
      method: "GET",
      output: struct.number(),
      path: "/num",
    });
    const useBoolean = defineRequest({
      method: "GET",
      output: struct.boolean(),
      path: "/flag",
    });

    const [objectError, objectResult] = await client.execute(useObject());
    const [numberError, numberResult] = await client.execute(useNumber());
    const [booleanError, booleanResult] = await client.execute(useBoolean());

    expect(objectError).toBeNull();
    expect(objectResult).toEqual({ id: 1 });
    expect(numberError).toBeNull();
    expect(numberResult).toBe(7);
    expect(booleanError).toBeNull();
    expect(booleanResult).toBe(true);
  });

  test("should read a string error as raw text", async () => {
    const client = clientReturning("missing", 404, TEXT_HEADERS);
    const useRequest = defineRequest({
      error: struct.string(),
      method: "GET",
      output: struct.blob(),
      path: "/missing",
    });

    const [error] = await client.execute(useRequest());

    expect(error?.code).toBe("HTTP_STATUS");
    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }
    expect(error.data).toBe("missing");
  });

  test("should read a blob error as a Blob", async () => {
    const client = clientReturning(
      new Uint8Array([1, 2, 3]),
      404,
      BYTES_HEADERS,
    );
    const useRequest = defineRequest({
      error: struct.blob(),
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/missing",
    });

    const [error] = await client.execute(useRequest());

    expect(error?.code).toBe("HTTP_STATUS");
    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }
    expect(error.data).toBeInstanceOf(Blob);
    await expect((error.data as Blob).arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
  });

  test("should read an arrayBuffer error as bytes", async () => {
    const client = clientReturning(new Uint8Array([4, 5]), 404, BYTES_HEADERS);
    const useRequest = defineRequest({
      error: struct.arrayBuffer(),
      method: "GET",
      output: struct.string(),
      path: "/missing",
    });

    const [error] = await client.execute(useRequest());

    expect(error?.code).toBe("HTTP_STATUS");
    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }
    expect(error.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(error.data as ArrayBuffer)).toEqual(
      new Uint8Array([4, 5]),
    );
  });

  test("should read an object error as JSON while a blob output stays binary", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(async (input) => {
        const href = input instanceof Request ? input.url : String(input);
        if (new URL(href).pathname === "/missing") {
          return new Response(JSON.stringify({ message: "gone" }), {
            headers: JSON_HEADERS,
            status: 404,
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: BYTES_HEADERS,
          status: 200,
        });
      }),
    );
    const useMissing = defineRequest({
      error: struct.object({ message: struct.string() }),
      method: "GET",
      output: struct.blob(),
      path: "/missing",
    });
    const useOk = defineRequest({
      error: struct.object({ message: struct.string() }),
      method: "GET",
      output: struct.blob(),
      path: "/ok",
    });

    const [error] = await client.execute(useMissing());
    const [okError, okResult] = await client.execute(useOk());

    expect(error?.code).toBe("HTTP_STATUS");
    if (error?.code !== "HTTP_STATUS") {
      throw new Error("Expected an http status fault");
    }
    expect(error.data).toEqual({ message: "gone" });
    expect(okError).toBeNull();
    expect(okResult).toBeInstanceOf(Blob);
  });

  test("should keep a file error body off the JSON path", async () => {
    const client = clientReturning(
      new Uint8Array([1, 2, 3]),
      404,
      BYTES_HEADERS,
    );
    const useRequest = defineRequest({
      error: struct.file(),
      method: "GET",
      output: struct.arrayBuffer(),
      path: "/missing",
    });

    const [error] = await client.execute(useRequest());

    expect(error?.code).toBe("RES_STRUCT_MISMATCH");
  });

  test("should decode JSON error bodies from an already-parsed value, bytes, and blobs", async () => {
    const bufferBytes = new TextEncoder().encode(
      JSON.stringify({ message: "buffer-body" }),
    );
    // A string on a JSON representation is a JSON string root, so the object case must already be parsed.
    const payloads = [
      { message: "string-body" },
      new TextEncoder().encode(JSON.stringify({ message: "view-body" })),
      bufferBytes.buffer.slice(
        bufferBytes.byteOffset,
        bufferBytes.byteOffset + bufferBytes.byteLength,
      ),
      new Blob([JSON.stringify({ message: "blob-body" })], {
        type: "application/json",
      }),
    ];
    let index = 0;
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () => {
          const body = payloads[index];
          index += 1;
          if (body === undefined) {
            throw new Error("missing payload");
          }
          return makeResponse({
            body,
            headers: new Headers(JSON_HEADERS),
            status: 404,
          });
        }),
      ),
    );
    const useRequest = defineRequest({
      error: struct.object({ message: struct.string() }),
      method: "GET",
      output: struct.arrayBuffer(),
      path: "/missing",
    });

    const messages = [];
    for (let i = 0; i < payloads.length; i += 1) {
      const [error] = await client.execute(useRequest());
      expect(error?.code).toBe("HTTP_STATUS");
      if (error?.code !== "HTTP_STATUS") {
        throw new Error("Expected an http status fault");
      }
      messages.push(error.data.message);
    }

    expect(messages).toEqual([
      "string-body",
      "view-body",
      "buffer-body",
      "blob-body",
    ]);
  });

  test("should keep an interceptor JSON string as a string root", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: "123",
            headers: new Headers(JSON_HEADERS),
            status: 200,
          }),
        ),
      ),
    );
    const useRequest = defineRequest({
      method: "GET",
      output: struct.unknown(),
      path: "/root-string",
    });

    const [error, data] = await client.execute(useRequest());

    expect(error).toBeNull();
    expect(data).toBe("123");
  });

  test("should reject a JSON string that only looks like an object", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: '{"role":"admin"}',
            headers: new Headers(JSON_HEADERS),
            status: 200,
          }),
        ),
      ),
    );
    const useRequest = defineRequest({
      method: "GET",
      output: struct.object({ role: struct.string() }),
      path: "/object-text",
    });

    const [error, data] = await client.execute(useRequest());

    expect(error?.code).toBe("RES_STRUCT_MISMATCH");
    expect(data).toBeUndefined();
  });

  test("should keep a declared arrayBuffer error body off the JSON decode path", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({ body: { message: "gone" }, status: 404 }),
        ),
      ),
    );
    const useRequest = defineRequest({
      error: struct.arrayBuffer(),
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/missing-bytes",
    });

    const [error] = await client.execute(useRequest());

    expect(error?.code).toBe("RES_STRUCT_MISMATCH");
  });

  test("should reject a non-text interceptor body for a string error", async () => {
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({ body: 404, status: 404 }),
        ),
      ),
    );
    const useRequest = defineRequest({
      error: struct.string(),
      method: "GET",
      output: struct.arrayBuffer(),
      path: "/missing",
    });

    const [error] = await client.execute(useRequest());

    expect(error?.code).toBe("RES_STRUCT_MISMATCH");
  });

  test("should classify a JSON body nested past the Struct depth limit as RES_STRUCT_MISMATCH", async () => {
    const Chain = struct.object({
      get child(): StructLike {
        return Chain.null();
      },
    });
    const depth = 100_000;
    const client = clientReturning(
      '{"child":'.repeat(depth) + "null" + "}".repeat(depth),
      200,
      JSON_HEADERS,
    );
    const useRequest = defineRequest({
      method: "GET",
      output: Chain,
      path: "/deep",
    });

    const [error, data] = await client.execute(useRequest());

    expect(error?.code).toBe("RES_STRUCT_MISMATCH");
    expect(error?.cause).toBeInstanceOf(StructError);
    expect(data).toBeUndefined();
  });
});
