import { describe, expect, test } from "vitest";
import { createClient, withEndpoint, withHTTPHandle } from "../client";
import { struct } from "../struct";
import { defineRequest } from "./http";

/**
 * Locks the routing table for `output` / `error` declarations.
 *
 * Philosophy 2: `ok` is the only fork, and only one side ever decodes.
 * Philosophy 5: with nothing declared for a side, that body is never read — not even to fail
 * on. An unreadable representation on the side you opted out of is none of your business.
 *
 * Transport and extension failures are the exception: they happened to the request rather than
 * to a declared body, so they outrank the declaration table entirely.
 */

const User = struct.object({ id: struct.number() });
const ApiError = struct.object({ message: struct.string() });

const JSON_HEADERS = { "content-type": "application/json" };
const HTML_HEADERS = { "content-type": "text/html" };

function clientFor(
  body: string,
  status: number,
  headers: Record<string, string>,
): ReturnType<typeof createClient> {
  const handle = (async () =>
    new Response(body, { headers, status })) as unknown as typeof fetch;

  return createClient(
    withEndpoint("https://api.example.test"),
    withHTTPHandle(handle),
  );
}

describe("declaration routing", () => {
  describe("both sides declared", () => {
    const useRequest = defineRequest({
      error: ApiError,
      method: "GET",
      output: User,
      path: "/x",
    });

    test("should decode the success body on 2xx", async () => {
      const [fault, data] = await clientFor(
        '{"id":1}',
        200,
        JSON_HEADERS,
      ).execute(useRequest());

      expect(fault).toBeNull();
      expect(data).toEqual({ id: 1 });
    });

    test("should decode the error body on non-2xx", async () => {
      const [fault] = await clientFor(
        '{"message":"nope"}',
        500,
        JSON_HEADERS,
      ).execute(useRequest());

      expect(fault?.code).toBe("HTTP_STATUS");
      if (fault?.code !== "HTTP_STATUS")
        throw new Error("Expected an http status fault");
      expect(fault.data).toEqual({ message: "nope" });
    });

    test.each([
      ["2xx", 200],
      ["non-2xx", 500],
    ])(
      "should report an unreadable %s body it was told to decode",
      async (_label, status) => {
        const [fault] = await clientFor(
          "{not json",
          status,
          JSON_HEADERS,
        ).execute(useRequest());

        expect(fault?.code).toBe("RES_DECODE_FAILED");
      },
    );
  });

  describe("only output declared", () => {
    const useRequest = defineRequest({
      method: "GET",
      output: User,
      path: "/x",
    });

    test("should ignore an unreadable non-2xx body", async () => {
      const [fault, data, response] = await clientFor(
        "{not json",
        500,
        JSON_HEADERS,
      ).execute(useRequest());

      expect(data).toBeUndefined();
      expect(response).toBeUndefined();
      expect(fault?.code).toBe("HTTP_STATUS");
      if (fault?.code !== "HTTP_STATUS")
        throw new Error("Expected an http status fault");
      expect(fault.status).toBe(500);
      expect(fault.data).toBeUndefined();
      expect(fault.response).not.toHaveProperty("body");
    });

    test("should ignore a non-JSON non-2xx body", async () => {
      const [fault] = await clientFor(
        "<html>gateway</html>",
        502,
        HTML_HEADERS,
      ).execute(useRequest());

      expect(fault?.code).toBe("HTTP_STATUS");
      if (fault?.code !== "HTTP_STATUS")
        throw new Error("Expected an http status fault");
      expect(fault.status).toBe(502);
      expect(fault.data).toBeUndefined();
    });
  });

  describe("only error declared", () => {
    const useRequest = defineRequest({
      error: ApiError,
      method: "GET",
      path: "/x",
    });

    test("should ignore an unreadable 2xx body", async () => {
      const [fault, data, response] = await clientFor(
        "{not json",
        200,
        JSON_HEADERS,
      ).execute(useRequest());

      expect(fault).toBeNull();
      expect(data).toBeUndefined();
      expect(response?.status).toBe(200);
      expect(response).not.toHaveProperty("body");
    });

    test("should ignore a non-JSON 2xx body", async () => {
      const [fault, data] = await clientFor(
        "<html>ok</html>",
        200,
        HTML_HEADERS,
      ).execute(useRequest());

      expect(fault).toBeNull();
      expect(data).toBeUndefined();
    });
  });

  describe("one side declared", () => {
    test.each([
      [200, "error"],
      [500, "output"],
    ] as const)(
      "cancels the HTTP %s body when only %s is declared",
      async (status, declared) => {
        let cancelled = false;
        const handle = (async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
              },
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('{"id":1,"message":"nope"}'),
                );
                controller.close();
              },
            }),
            { headers: JSON_HEADERS, status },
          )) as unknown as typeof fetch;
        const endpoint =
          declared === "error"
            ? defineRequest({ error: ApiError, method: "GET", path: "/x" })
            : defineRequest({ method: "GET", output: User, path: "/x" });

        const [fault, data] = await createClient(
          withEndpoint("https://api.example.test"),
          withHTTPHandle(handle),
        ).execute(endpoint());

        expect(cancelled).toBe(true);
        expect(data).toBeUndefined();
        expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
      },
    );
  });

  describe("neither side declared", () => {
    const useRequest = defineRequest({ method: "GET", path: "/x" });

    test("should succeed on 2xx without reading the body", async () => {
      const [fault, data, response] = await clientFor(
        "<html>ok</html>",
        200,
        HTML_HEADERS,
      ).execute(useRequest());

      expect(fault).toBeNull();
      expect(data).toBeUndefined();
      expect(response?.status).toBe(200);
      expect(response).not.toHaveProperty("body");
    });

    test("should report a non-2xx status without reading the body", async () => {
      const [fault] = await clientFor(
        "<html>boom</html>",
        503,
        HTML_HEADERS,
      ).execute(useRequest());

      expect(fault?.code).toBe("HTTP_STATUS");
      if (fault?.code !== "HTTP_STATUS")
        throw new Error("Expected an http status fault");
      expect(fault.status).toBe(503);
      expect(fault.data).toBeUndefined();
      expect(fault.response).not.toHaveProperty("body");
    });
  });

  describe("transport and extension failures outrank the declaration table", () => {
    const observerError = new Error("observer exploded");

    function clientStreaming(): ReturnType<typeof createClient> {
      const handle = (async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"id":1}'));
            controller.close();
          },
        });
        return new Response(stream, { headers: JSON_HEADERS, status: 200 });
      }) as unknown as typeof fetch;

      return createClient(
        withEndpoint("https://api.example.test"),
        withHTTPHandle(handle),
      );
    }

    test("should report a throwing download observer regardless of which side decodes", async () => {
      const useRequest = defineRequest({
        error: ApiError,
        method: "GET",
        output: User,
        path: "/x",
      });
      const [fault] = await clientStreaming().execute(useRequest(), {
        onDownloadProgress: () => {
          throw observerError;
        },
      });

      expect(fault?.code).toBe("EXT_OBSERVER_FAILED");
      expect(fault?.cause).toBe(observerError);
    });

    test("should never run a download observer when nothing is declared", async () => {
      // Philosophy 5 taken to its conclusion: with nothing declared the body is not read, so
      // there is no transfer to observe. Do not "fix" this by forcing a read nobody asked for.
      const useRequest = defineRequest({ method: "GET", path: "/x" });
      let calls = 0;
      const [fault, data] = await clientStreaming().execute(useRequest(), {
        onDownloadProgress: () => {
          calls += 1;
          throw observerError;
        },
      });

      expect(calls).toBe(0);
      expect(fault).toBeNull();
      expect(data).toBeUndefined();
    });

    test("should attribute a transport rejection to the network, not to an interceptor", async () => {
      // Both a dead server and a throwing interceptor arrive at the chain's catch as one bare
      // cause. Only the transport boundary knows which happened, so it tags its own rejections.
      const networkError = new TypeError("fetch failed");
      const handle = (async () => {
        throw networkError;
      }) as unknown as typeof fetch;

      const useRequest = defineRequest({
        method: "GET",
        output: User,
        path: "/x",
      });
      const [fault] = await createClient(
        withEndpoint("https://api.example.test"),
        withHTTPHandle(handle),
      ).execute(useRequest());

      expect(fault?.code).toBe("NET_UNREACHABLE");
      expect(fault?.cause).toBe(networkError);
    });

    test("should attribute a transport that throws a primitive to the extension", async () => {
      // The transport-origin mark is kept beside the value, which a primitive cannot carry. A
      // transport that rejects with a string is broken in a way we cannot distinguish, and the
      // documented consequence is that it is attributed to the extension.
      const handle = (async () => {
        throw "offline";
      }) as unknown as typeof fetch;

      const useRequest = defineRequest({
        method: "GET",
        output: User,
        path: "/x",
      });
      const [fault] = await createClient(
        withEndpoint("https://api.example.test"),
        withHTTPHandle(handle),
      ).execute(useRequest());

      expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
      expect(fault?.cause).toBe("offline");
    });

    test("should still report a truncated body with nothing declared", async () => {
      const readError = new Error("read failed");
      const handle = (async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(readError);
          },
        });
        return new Response(stream, { headers: JSON_HEADERS, status: 200 });
      }) as unknown as typeof fetch;

      const useRequest = defineRequest({
        method: "GET",
        output: User,
        path: "/x",
      });
      const [fault] = await createClient(
        withEndpoint("https://api.example.test"),
        withHTTPHandle(handle),
      ).execute(useRequest());

      expect(fault?.code).toBe("NET_BODY_INCOMPLETE");
      expect(fault?.cause).toBe(readError);
    });
  });
});
