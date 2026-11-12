import { afterEach, describe, expect, inject, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../../client";
import type { HttpProgressEvent, HttpRequest } from "../../http";
import { defineRequest } from "../../http";
import {
  basicAuthHttpInterceptor,
  createHttpInterceptor,
} from "../../interceptor";
import { struct } from "../../struct";
import { createHttpRequest } from "../request";
import { fetchHandler } from "./fetch";
import { __resetStreamingRequestBodySupportForTests } from "./fetch_init";
import { fixture } from "../../../test/fixture/client-auto";
import { initOf } from "../../../test/fetch-request-init";

function requireRequest(input: RequestInfo | URL): Request {
  if (input instanceof Request) return input;
  throw new Error("expected Request");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetStreamingRequestBodySupportForTests();
});

describe("HTTP transport boundary regressions", () => {
  test.each(["timeout", "abort"] as const)(
    "should classify %s during preflight and leave the serialized body unlocked",
    async (mode) => {
      await expectCancelledStalledFormData(mode, "preflight");
    },
  );

  test.each([
    "header",
    "sameHeader",
    "mutatedHeader",
    "bodyContentType",
    "none",
    "remove",
    "null",
  ] as const)(
    "should apply interceptor body replacement with %s content type metadata",
    async (declaration) => {
      let contentType: string | null = null;
      let sent = "";
      const client = createClient(
        withEndpoint("https://example.com"),
        withInterceptors(
          createHttpInterceptor((request, next) => {
            const replaced: HttpRequest = {
              ...request,
              body: declaration === "remove" ? undefined : '{"next":true}',
            };
            if (declaration === "header") {
              replaced.headers = new Headers({
                "content-type": "application/merge-patch+json",
              });
            }
            if (declaration === "sameHeader") {
              replaced.headers = new Headers({
                "content-type": "application/json",
              });
            }
            if (declaration === "mutatedHeader") {
              replaced.headers?.set("content-type", "application/json");
            }
            if (declaration === "bodyContentType") {
              replaced.bodyContentType = "application/json";
            }
            if (declaration === "null") {
              replaced.bodyContentType = null;
            }
            return next(replaced);
          }),
        ),
        withHTTPHandle(async (input) => {
          contentType = requireRequest(input).headers.get("content-type");
          sent = await requireRequest(input).text();
          return new Response(null, { status: 204 });
        }),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: { before: true } }),
        method: "POST",
        path: "/upload",
      });
      const [fault] = await endpoint(client);
      expect(fault).toBeNull();
      expect(sent).toBe(declaration === "remove" ? "" : '{"next":true}');
      expect(contentType).toBe(
        declaration === "header"
          ? "application/merge-patch+json"
          : declaration === "sameHeader" || declaration === "mutatedHeader"
            ? "application/json"
            : declaration === "remove"
              ? null
              : "text/plain;charset=UTF-8",
      );
    },
  );

  test("should let a signing interceptor read the inferred public body media type", async () => {
    let signedType: string | null = null;
    let contentType: string | null = null;
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          expect(request.headers?.has("content-type")).toBe(false);
          request.headers?.set(
            "x-signed-content-type",
            request.bodyContentType ?? "missing",
          );
          return next(request);
        }),
      ),
      withHTTPHandle((input) => {
        signedType = requireRequest(input).headers.get("x-signed-content-type");
        contentType = requireRequest(input).headers.get("content-type");
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    const endpoint = defineRequest({
      builder: () => ({ body: { signed: true } }),
      method: "POST",
      path: "/",
    });
    expect((await endpoint(client))[0]).toBeNull();
    expect(signedType).toBe("application/json");
    expect(contentType).toBe("application/json");
  });

  test.each(["basicAuth", "bodyReplacement", "frozenClone"] as const)(
    "should keep inferred media type readable after a %s interceptor copies the request",
    async (rewrite) => {
      let signedType: string | null = null;
      let contentType: string | null = null;
      let authorization: string | null = null;
      const client = createClient(
        withEndpoint("https://example.com"),
        withInterceptors(
          rewrite === "basicAuth"
            ? basicAuthHttpInterceptor(() => ({ username: "u", password: "p" }))
            : createHttpInterceptor((request, next) =>
                next(
                  rewrite === "frozenClone"
                    ? Object.freeze({ ...request })
                    : {
                        ...request,
                        body: "changed",
                        headers: new Headers({
                          "content-type": "text/plain;charset=UTF-8",
                        }),
                      },
                ),
              ),
          createHttpInterceptor((request, next) => {
            request.headers?.set(
              "x-signed-content-type",
              request.headers.get("content-type") ??
                request.bodyContentType ??
                "missing",
            );
            return next(request);
          }),
        ),
        withHTTPHandle((input) => {
          const headers = requireRequest(input).headers;
          signedType = headers.get("x-signed-content-type");
          contentType = headers.get("content-type");
          authorization = headers.get("authorization");
          return Promise.resolve(new Response(null, { status: 204 }));
        }),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: { signed: true } }),
        method: "POST",
        path: "/",
      });
      expect((await endpoint(client))[0]).toBeNull();
      expect(signedType).toBe(
        rewrite === "bodyReplacement"
          ? "text/plain;charset=UTF-8"
          : "application/json",
      );
      expect(contentType).toBe(
        rewrite === "bodyReplacement"
          ? "text/plain;charset=UTF-8"
          : "application/json",
      );
      expect(authorization).toBe(rewrite === "basicAuth" ? "Basic dTpw" : null);
    },
  );

  test.each(["inferred", "explicit"] as const)(
    "should preserve a direct header override with %s body metadata",
    async (metadata) => {
      let contentType: string | null = null;
      const client = createClient(
        withEndpoint("https://example.com"),
        withInterceptors(
          createHttpInterceptor((request, next) => {
            request.headers?.set("content-type", "application/custom");
            if (metadata === "explicit") {
              request.bodyContentType = "application/json";
            }
            return next(request);
          }),
        ),
        withHTTPHandle((input) => {
          contentType = requireRequest(input).headers.get("content-type");
          return Promise.resolve(new Response(null, { status: 204 }));
        }),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: { before: true } }),
        method: "POST",
        path: "/",
      });
      expect((await endpoint(client))[0]).toBeNull();
      expect(contentType).toBe("application/custom");
    },
  );

  test("should let an interceptor sign the inferred type on its own copy of the request", async () => {
    let signedType: string | null = null;
    let contentType: string | null = null;
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          const copy = { ...request, headers: new Headers(request.headers) };
          copy.headers.set(
            "x-signed-content-type",
            copy.headers.get("content-type") ??
              copy.bodyContentType ??
              "missing",
          );
          return next(copy);
        }),
      ),
      withHTTPHandle((input) => {
        signedType = requireRequest(input).headers.get("x-signed-content-type");
        contentType = requireRequest(input).headers.get("content-type");
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    const endpoint = defineRequest({
      builder: () => ({ body: { signed: true } }),
      method: "POST",
      path: "/",
    });
    expect((await endpoint(client))[0]).toBeNull();
    expect(signedType).toBe("application/json");
    expect(contentType).toBe("application/json");
  });

  test("should retain a declared header when an interceptor removes the body", () => {
    const request = createHttpRequest(
      "POST",
      "/",
      undefined,
      () => ({
        body: "before",
        headers: { "content-type": "application/custom" },
      }),
      {
        signal: new AbortController().signal,
        baseEndpoint: "https://example.com",
      },
    );
    expect(
      new Headers(initOf({ ...request, body: undefined }).headers).get(
        "content-type",
      ),
    ).toBe("application/custom");
    return Promise.resolve();
  });

  test.each([
    { encoding: "gzip", total: 0 },
    { encoding: "br", total: 0 },
    { encoding: "", total: 0 },
    { encoding: "identity", total: 5 },
    { encoding: " IDENTITY ", total: 5 },
    { encoding: undefined, total: 5 },
  ])(
    "should report decoded download length for encoding $encoding",
    async ({ encoding, total }) => {
      const events: HttpProgressEvent[] = [];
      const response = await fetchHandler(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/",
          method: "GET",
          responseType: "text",
          downloadProgress: (event) => {
            events.push(event);
          },
        },
        () =>
          Promise.resolve(
            new Response("hello", {
              headers: {
                "content-length": "5",
                ...(encoding === undefined
                  ? {}
                  : { "content-encoding": encoding }),
              },
            }),
          ),
      );
      expect(response.body).toBe("hello");
      expect(events.at(-1)).toEqual({
        lengthComputable: total > 0,
        loaded: 5,
        total,
      });
    },
  );

  test("should stop trusting Content-Length once decoded bytes exceed it without an exposed encoding", async () => {
    const events: HttpProgressEvent[] = [];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of ["ab", "cdef", "gh"]) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/",
        method: "GET",
        responseType: "text",
        downloadProgress: (event) => {
          events.push(event);
        },
      },
      () =>
        Promise.resolve(
          new Response(body, { headers: { "content-length": "3" } }),
        ),
    );
    expect(response.body).toBe("abcdefgh");
    expect(events).toEqual([
      { lengthComputable: true, loaded: 2, total: 3 },
      { lengthComputable: false, loaded: 6, total: 0 },
      { lengthComputable: false, loaded: 8, total: 0 },
    ]);
  });

  test.each(["default", "custom"] as const)(
    "should report unknown total for a real gzip response via %s fetch",
    async (handle) => {
      const text = "decoded ".repeat(1000);
      const events: HttpProgressEvent[] = [];
      const f = fixture(inject("testServerHost"), inject("fixtureToken"));
      const url = await f.endpoint("gz", "gzip", {
        body: text,
        contentType: "text/plain",
      });
      const client =
        handle === "default"
          ? createClient(withEndpoint(url))
          : createClient(
              withEndpoint(url),
              withHTTPHandle((input, init) => fetch(input, init)),
            );
      const [fault, data] = await defineRequest({
        method: "GET",
        output: struct.string(),
        path: "/",
      })(
        client({
          onDownloadProgress: (event) => {
            events.push(event);
          },
        }),
      );
      expect(fault).toBeNull();
      expect(data).toBe(text);
      expect(events.at(-1)).toEqual({
        lengthComputable: false,
        loaded: 8000,
        total: 0,
      });
    },
  );
});

async function expectCancelledStalledFormData(
  mode: "timeout" | "abort",
  when: "body" | "preflight",
): Promise<void> {
  const form = new FormData();
  const cancel = vi.fn();
  let release!: () => void;
  let entered!: () => void;
  const handleEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const source = new ReadableStream<Uint8Array>({
    cancel,
    start(controller) {
      release = () => controller.close();
    },
  });
  class SerializedResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(
        body === form ? source : body,
        body === form
          ? {
              headers: {
                "content-type": "multipart/form-data; boundary=fixture",
              },
            }
          : init,
      );
    }
  }
  vi.stubGlobal("Response", SerializedResponse);
  const controller = new AbortController();
  const reason =
    mode === "timeout"
      ? new DOMException("deadline", "TimeoutError")
      : undefined;
  const client = createClient(
    withEndpoint("https://example.com"),
    withHTTPHandle(async (input) => {
      entered();
      await requireRequest(input).arrayBuffer();
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    builder: () => {
      if (when === "preflight") {
        controller.abort(reason);
      }
      return { body: form };
    },
    method: "POST",
    path: "/",
  });
  const pending = endpoint(
    client({ signal: controller.signal, onUploadProgress: () => undefined }),
  );
  try {
    if (when === "preflight") {
      const [fault] = await pending;
      expect(fault?.code).toBe(
        mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
      );
      expect(cancel).not.toHaveBeenCalled();
      expect(source.locked).toBe(false);
      return;
    }
    await handleEntered;
    expect(source.locked).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    controller.abort(reason);
    const [fault] = await pending;
    expect(fault?.code).toBe(
      mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  } finally {
    if (source.locked) {
      release();
      await pending;
    }
  }
}
