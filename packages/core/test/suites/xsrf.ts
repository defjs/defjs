import { afterEach, expect, test, vi } from "vitest";
import { CLIENT } from "../../src/client/client.ts";
import {
  createClient,
  type FetchHandle,
  withEndpoint,
  withHTTPHandle,
} from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import type { HttpRequest } from "../../src/internal/http_request.ts";
import { withXSRF, type XSRFOptions } from "../../src/xsrf/index.ts";
import { assertXsrfRuntime } from "../../src/xsrf/xsrf.ts";
import { initOf } from "../fetch-request-init.ts";

const UNIT_COOKIE = "XSRF-UNIT";
const UNIT_HEADER = "X-XSRF-UNIT";
const UNIT_NAMES = [UNIT_COOKIE, "OTHER-UNIT", "CUSTOM-XSRF-TOKEN"];

function clearUnitCookies(): void {
  for (const name of UNIT_NAMES) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

function asRequest(input: Parameters<FetchHandle>[0]): Request {
  if (input instanceof Request) return input;
  throw new Error("expected Request");
}

async function sentHeader(options: {
  method?: string;
  endpoint?: string;
  path?: string;
  xsrf?: XSRFOptions;
  requestHeaders?: HeadersInit;
}): Promise<string | null> {
  const headerName = options.xsrf?.headerName ?? "X-XSRF-TOKEN";
  let header: string | null = null;
  const client = createClient(
    withEndpoint(options.endpoint ?? location.origin),
    withHTTPHandle((input) => {
      header = asRequest(input).headers.get(headerName);
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
    withXSRF(options.xsrf),
  );
  const method = options.method ?? "POST";
  const path = options.path ?? "/submit";
  const definition = options.requestHeaders
    ? defineRequest({
        builder: () => ({ headers: options.requestHeaders }),
        method,
        path,
      })
    : defineRequest({ method, path });
  const [error] = await definition(client);
  expect(error).toBeNull();
  return header;
}

const locationMessage =
  "withXSRF requires a browser runtime: globalThis.location is missing";
const documentMessage =
  "withXSRF requires a browser runtime: globalThis.document is missing";

export function registerXsrfSuite(): void {
  afterEach(() => {
    clearUnitCookies();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("assertXsrfRuntime rejects a scope without location", () => {
    let caught: unknown;
    try {
      assertXsrfRuntime({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error("expected assertXsrfRuntime to throw");
    }
    expect(caught.message).toBe(locationMessage);
  });

  test("assertXsrfRuntime rejects a scope without document", () => {
    let caught: unknown;
    try {
      assertXsrfRuntime({ location: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) {
      throw new Error("expected assertXsrfRuntime to throw");
    }
    expect(caught.message).toBe(documentMessage);
  });

  test("assertXsrfRuntime accepts location and document", () => {
    expect(() =>
      assertXsrfRuntime({ location: {}, document: {} }),
    ).not.toThrow();
  });

  test("should inject xsrf header for mutating same-origin requests from cookie", async () => {
    setCookie(UNIT_COOKIE, encodeURIComponent("a b=c"));
    const header = await sentHeader({
      xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
    });
    expect(header).toBe("a b=c");
  });

  test.each(["GET", "HEAD", "OPTIONS"])(
    "should not inject xsrf header for safe %s requests",
    async (method) => {
      setCookie(UNIT_COOKIE, "cookie-token");
      const reads = vi.spyOn(Document.prototype, "cookie", "get");
      const header = await sentHeader({
        method,
        xsrf: {
          cookieName: UNIT_COOKIE,
          headerName: UNIT_HEADER,
        },
      });
      expect(header).toBeNull();
      expect(reads).not.toHaveBeenCalled();
    },
  );

  test("should not inject xsrf header for safe TRACE requests", () => {
    setCookie(UNIT_COOKIE, "cookie-token");
    const reads = vi.spyOn(Document.prototype, "cookie", "get");
    const client = createClient(
      withEndpoint(location.origin),
      withXSRF({
        cookieName: UNIT_COOKIE,
        headerName: UNIT_HEADER,
      }),
    );
    const finalizeHeaders = client[CLIENT].config.finalizeHeaders;
    if (!finalizeHeaders) throw new Error("expected finalizeHeaders");
    const request: HttpRequest = {
      baseEndpoint: location.origin,
      endpoint: "/submit",
      finalizeHeaders,
      method: "TRACE",
    };
    const init = initOf(request);
    if (!(init.headers instanceof Headers)) throw new Error("expected Headers");
    expect(init.headers.get(UNIT_HEADER)).toBeNull();
    expect(reads).not.toHaveBeenCalled();
  });

  test("should inject xsrf header for custom unsafe methods", async () => {
    setCookie(UNIT_COOKIE, "cookie-token");
    const header = await sentHeader({
      method: "PROPPATCH",
      xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
    });
    expect(header).toBe("cookie-token");
  });

  test("should not inject xsrf header for cross-origin requests", async () => {
    setCookie(UNIT_COOKIE, "cookie-token");
    const reads = vi.spyOn(Document.prototype, "cookie", "get");
    const header = await sentHeader({
      endpoint: "https://cross-origin.example",
      xsrf: {
        cookieName: UNIT_COOKIE,
        headerName: UNIT_HEADER,
      },
    });
    expect(header).toBeNull();
    expect(reads).not.toHaveBeenCalled();
  });

  test("should not inject xsrf header when browser cookie is empty", async () => {
    vi.spyOn(Document.prototype, "cookie", "get").mockReturnValue("");
    const header = await sentHeader({
      xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
    });
    expect(header).toBeNull();
  });

  test("should not inject xsrf header when browser cookie name does not match", async () => {
    setCookie("OTHER-UNIT", "other-token");
    const header = await sentHeader({
      xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
    });
    expect(header).toBeNull();
  });

  test("should not inject xsrf header when browser cookie value is empty", async () => {
    setCookie(UNIT_COOKIE, "");
    const header = await sentHeader({
      xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
    });
    expect(header).toBeNull();
  });

  test("should not inject xsrf header when browser cookie access throws", async () => {
    vi.spyOn(Document.prototype, "cookie", "get").mockImplementation(() => {
      throw new Error("cookie unavailable");
    });
    const header = await sentHeader({
      xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
    });
    expect(header).toBeNull();
  });

  test("should not override an existing xsrf header", async () => {
    setCookie(UNIT_COOKIE, "cookie-token");
    const reads = vi.spyOn(Document.prototype, "cookie", "get");
    const headers = new Headers([[UNIT_HEADER, "existing-token"]]);
    const header = await sentHeader({
      requestHeaders: headers,
      xsrf: {
        cookieName: UNIT_COOKIE,
        headerName: UNIT_HEADER,
      },
    });
    expect(header).toBe("existing-token");
    expect(reads).not.toHaveBeenCalled();
  });

  test("should apply a custom xsrf header name from the cookie", async () => {
    setCookie("CUSTOM-XSRF-TOKEN", "xsrf-token");
    const header = await sentHeader({
      xsrf: {
        cookieName: "CUSTOM-XSRF-TOKEN",
        headerName: "X-CUSTOM-XSRF-TOKEN",
      },
    });
    expect(header).toBe("xsrf-token");
  });

  async function send(options: { method?: string; xsrf: XSRFOptions }) {
    const handle = vi.fn<FetchHandle>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const [fault] = await defineRequest({
      method: options.method ?? "POST",
      path: "/submit",
    })(
      createClient(
        withEndpoint(location.origin),
        withHTTPHandle(handle),
        withXSRF(options.xsrf),
      ),
    );
    return { fault, handle };
  }

  test("should fail a mutating request with EXT_HOOK_FAILED for an invalid header name, and leave safe methods alone", async () => {
    setCookie(UNIT_COOKIE, "cookie-token");
    const xsrf = { cookieName: UNIT_COOKIE, headerName: "bad header" };

    const post = await send({ xsrf });
    expect(post.fault?.code).toBe("EXT_HOOK_FAILED");
    expect(post.fault?.cause).toBeInstanceOf(TypeError);
    expect(post.handle).not.toHaveBeenCalled();

    const get = await send({ method: "GET", xsrf });
    expect(get.fault).toBeNull();
    expect(get.handle).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["CR and LF", encodeURIComponent("a\r\nX-Evil: 1")],
    ["NUL", encodeURIComponent("a\u0000b")],
    ["a code point above U+00FF", encodeURIComponent("\u20ac")],
  ])(
    "should fail with EXT_HOOK_FAILED when the decoded token holds %s",
    async (_label, cookie) => {
      setCookie(UNIT_COOKIE, cookie);

      const { fault, handle } = await send({
        xsrf: { cookieName: UNIT_COOKIE, headerName: UNIT_HEADER },
      });

      expect(fault?.code).toBe("EXT_HOOK_FAILED");
      expect(fault?.cause).toBeInstanceOf(TypeError);
      expect(handle).not.toHaveBeenCalled();
    },
  );
}
