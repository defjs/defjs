import { expect, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  defineRequest,
  withEndpoint,
  withInterceptors,
} from "../../src/index.ts";
import { makeResponse } from "../../src/http/http_response.ts";

export function registerHttpResponseCopySuite(): void {
  test("accepts an interceptor response built by another core module instance", async () => {
    vi.resetModules();
    const other = await import("../../src/index.ts");
    expect(other.makeResponse).not.toBe(makeResponse);
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(other.makeResponse({ status: 200 })),
        ),
      ),
    );
    const request = defineRequest({ method: "GET", path: "/cached" });
    const [fault, , response] = await request(client);

    expect(fault).toBeNull();
    expect(response?.status).toBe(200);
  });
}
