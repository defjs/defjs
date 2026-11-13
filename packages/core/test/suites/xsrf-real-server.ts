import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createClient,
  type FetchHandle,
  withEndpoint,
  withHTTPHandle,
} from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { struct } from "../../src/struct/index.ts";
import { withXSRF } from "../../src/xsrf/index.ts";

export function registerXsrfRealServerSuite(): void {
  describe("xsrf real server", () => {
    afterEach(() => {
      document.cookie = "XSRF-TOKEN=; Max-Age=0; path=/";
    });

    test("withXSRF keeps the default cookie and header names when omitted", async () => {
      document.cookie = "XSRF-TOKEN=default-token; path=/";
      const fetchMock = vi.fn<FetchHandle>((input) => {
        if (!(input instanceof Request))
          return Promise.reject(new Error("expected Request"));
        expect(input.headers.get("X-XSRF-TOKEN")).toBe("default-token");
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      const client = createClient(
        withEndpoint(window.location.origin),
        withHTTPHandle(fetchMock),
        withXSRF(),
      );
      const [error] = await defineRequest({
        method: "POST",
        path: "/defaults",
      })(client);
      expect(error).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("should inject xsrf header from document.cookie on same-origin mutating requests", async () => {
      document.cookie = "XSRF-TOKEN=browser-cookie; path=/";

      const fetchMock = vi.fn<FetchHandle>((input) => {
        if (!(input instanceof Request))
          return Promise.reject(new Error("expected Request"));
        const request = input;
        expect(request.url).toBe(`${window.location.origin}/xsrf`);
        expect(request.headers.get("X-XSRF-TOKEN")).toBe("browser-cookie");
        return Promise.resolve(new Response(null, { status: 200 }));
      });

      const client = createClient(
        withEndpoint(window.location.origin),
        withHTTPHandle(fetchMock),
        withXSRF(),
      );

      const useXsrf = defineRequest({
        method: "POST",
        path: "/xsrf",
      });

      const [error, result, response] = await useXsrf(client);

      expect(error).toBeNull();
      expect(result).toBeUndefined();
      expect(response?.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("should validate xsrf token through real server round-trip", async () => {
      await fetch("/xsrf-token");

      const client = createClient(
        withEndpoint(window.location.origin),
        withXSRF(),
      );

      const useValidate = defineRequest({
        method: "POST",
        output: struct.object({ ok: struct.boolean() }),
        error: struct.object({ ok: struct.boolean(), reason: struct.string() }),
        path: "/xsrf-validate",
      });

      const [error, result, response] = await useValidate(client);

      expect(error).toBeNull();
      expect(result).toEqual({ ok: true });
      expect(response?.ok).toBe(true);
      expect(response?.status).toBe(200);
    });

    test("should be rejected by server when xsrf header is missing", async () => {
      await fetch("/xsrf-token");

      const client = createClient(withEndpoint(window.location.origin));

      const useValidate = defineRequest({
        method: "POST",
        output: struct.object({ ok: struct.boolean() }),
        error: struct.object({ ok: struct.boolean(), reason: struct.string() }),
        path: "/xsrf-validate",
      });

      const [error, result, response] = await useValidate(client);

      expect(result).toBeUndefined();
      expect(response).toBeUndefined();
      expect(error?.code).toBe("HTTP_STATUS");

      if (error?.code !== "HTTP_STATUS") {
        throw new Error("Expected an http status fault");
      }

      expect(error.response.ok).toBe(false);
      expect(error.status).toBe(403);
      expect(error.data.ok).toBe(false);
    });
  });
}
