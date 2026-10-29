import { expect, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "../../src";

test.each([200, 500])(
  "does not read the undeclared side of an HTTP %s response",
  async (status) => {
    const response = new Response('{"id":1}', {
      status,
      headers: { "content-type": "application/json" },
    });
    if (!response.body) throw new Error("Expected a response body");
    const reads = vi.spyOn(response.body, "getReader");
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async () => response),
    );
    const endpoint =
      status === 200
        ? defineRequest({
            method: "GET",
            path: "/probe",
            error: struct.object({ id: struct.number() }),
          })
        : defineRequest({
            method: "GET",
            path: "/probe",
            output: struct.object({ id: struct.number() }),
          });

    const [fault, value] = await client.execute(endpoint());
    expect(value).toBeUndefined();
    expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
    expect(reads).not.toHaveBeenCalled();
  },
);
