import { expect, test } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  defineEventStream,
  defineRequest,
  makeResponse,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
} from "../../src";

const mediaTypes = [
  ["application/problem+json; charset=utf-8", true],
  ["APPLICATION/VND.API+JSON", true],
  ["+json", false],
  ["application/+json", false],
  ["application/problem+json/extra", false],
  ["application/prob lem+json", false],
] as const;

test.each([200, 403])(
  "JSON media-type validation is shared by native and synthetic HTTP at %s",
  async (status) => {
    const endpoint = defineRequest({
      method: "GET",
      path: "/media",
      output: struct.null(),
      error: struct.null(),
    });
    for (const [contentType, valid] of mediaTypes) {
      for (const native of [true, false]) {
        const headers = new Headers({ "content-type": contentType });
        const client = createClient(
          withEndpoint("https://example.test"),
          native
            ? withHTTPHandle(() =>
                Promise.resolve(new Response("null", { status, headers })),
              )
            : withInterceptors(
                createHttpInterceptor(() =>
                  Promise.resolve(
                    makeResponse({ status, headers, body: null }),
                  ),
                ),
              ),
        );
        const [fault, data] = await endpoint(client);
        expect(fault?.code ?? null).toBe(
          valid
            ? status === 200
              ? null
              : "HTTP_STATUS"
            : "RES_MEDIA_TYPE_INVALID",
        );
        if (valid)
          expect(fault?.code === "HTTP_STATUS" ? fault.data : data).toBeNull();
        else expect(data).toBeUndefined();
      }
    }
  },
);

test("SSE handshake errors use the same JSON media-type validation", async () => {
  const endpoint = defineEventStream({
    path: "/media",
    events: { message: struct.string() },
    error: struct.null(),
  });
  for (const [contentType, valid] of mediaTypes) {
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response("null", {
            status: 403,
            headers: { "content-type": contentType },
          }),
        ),
      ),
    );
    const [fault, stream] = await endpoint(client);
    expect(fault?.code).toBe(valid ? "HTTP_STATUS" : "RES_MEDIA_TYPE_INVALID");
    expect(fault?.response?.status).toBe(403);
    expect(stream).toBeUndefined();
    if (fault?.code === "HTTP_STATUS") expect(fault.data).toBeNull();
  }
});

test.each([200, 403])(
  "defineRequest snapshots all top-level execution fields at status %s",
  async (status) => {
    const shape = struct.object({ value: struct.string() });
    const definition = {
      method: "POST",
      path: "/first",
      operation: "first",
      input: shape,
      output: struct.string(),
      error: struct.string(),
      builder: (input: { value: string }) => ({ body: input.value }),
    };
    const endpoint = defineRequest(definition);
    definition.method = "PUT";
    definition.path = "/second";
    definition.operation = "second";
    definition.input = struct.object({
      value: struct.string().alias("changed"),
    });
    definition.output = struct.string().alias("changed");
    definition.error = struct.string().alias("changed");
    definition.builder = () => ({ body: "changed" });
    const observed: unknown[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor((request) => {
          observed.push([
            request.method,
            request.endpoint,
            request.operation,
            request.body,
          ]);
          return Promise.resolve(makeResponse({ status, body: "result" }));
        }),
      ),
    );
    const [fault, data] = await endpoint(client, { value: "original" });
    expect(observed).toEqual([["POST", "/first", "first", "original"]]);
    expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
    expect(fault?.code === "HTTP_STATUS" ? fault.data : data).toBe("result");
  },
);
