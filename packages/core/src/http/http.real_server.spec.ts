import { beforeEach, describe, expect, inject, test } from "vitest";
import { createClient, withEndpoint } from "../client";
import type { DerivableClient } from "../client";
import { struct } from "../struct";
import { defineRequest } from "./index";

describe("http against the fixture server", () => {
  let baseClient: DerivableClient;

  beforeEach(() => {
    baseClient = createClient(withEndpoint(inject("testServerHost")));
  });

  test("should resolve request tuples", async () => {
    const useGetAccount = defineRequest({
      method: "GET",
      output: struct.object({
        id: struct.number(),
      }),
      path: "/json",
    });

    const [error, result, response] = await useGetAccount(baseClient);

    expect(error).toBeNull();
    expect(result).toEqual({ id: 1 });
    expect(response?.ok).toBe(true);
  });

  test("should reject a non-JSON body for a declared JSON output", async () => {
    const useMalformedResponse = defineRequest({
      method: "GET",
      output: struct.object({ id: struct.number() }),
      path: "/text",
    });

    const [error, result, response] = await useMalformedResponse(baseClient);

    expect(error?.code).toBe("RES_MEDIA_TYPE_INVALID");
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();

    if (error?.code !== "RES_MEDIA_TYPE_INVALID") {
      throw new Error("Expected a media type fault");
    }

    expect(error.response.status).toBe(200);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test("should support fetch download progress hooks", async () => {
    const downloadLoaded: number[] = [];

    const useCreateAccount = defineRequest({
      builder: (input) => ({ body: input.payload }),
      input: struct.object({ payload: struct.arrayBuffer() }),
      method: "POST",
      output: struct.arrayBuffer(),
      path: "/",
    });

    const [error, result, response] = await useCreateAccount(
      baseClient({
        onDownloadProgress(event) {
          downloadLoaded.push(event.loaded);
        },
      }),
      { payload: new Uint8Array(32 * 1024).buffer },
    );

    expect(error).toBeNull();
    if (!(result instanceof ArrayBuffer)) {
      throw new Error("Expected an ArrayBuffer response");
    }
    expect(result.byteLength).toBe(32 * 1024);
    expect(response?.ok).toBe(true);
    expect(downloadLoaded.length).toBeGreaterThan(0);
  });

  test("should classify AbortSignal.timeout as NET_TIMEOUT in request runtime", async () => {
    const useDelay = defineRequest({
      builder: (input) => ({ query: { ms: input.ms } }),
      input: struct.object({ ms: struct.number() }),
      method: "GET",
      path: "/delay",
    });

    const [error, result, response] = await useDelay(
      baseClient({ signal: AbortSignal.timeout(100) }),
      { ms: 1000 },
    );

    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(error?.code).toBe("NET_TIMEOUT");
  });
});
