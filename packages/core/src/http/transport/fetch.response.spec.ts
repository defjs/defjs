import { describe, expect, inject, test, vi } from "vitest";
import { ERR_ABORTED, ERR_TIMEOUT } from "../../error";
import type { HttpRequest } from "../../http";
import { fetchHandler } from "./fetch";

describe("Fetch handler responses", () => {
  test("should cancel an unused response body before returning", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });

    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/unused",
        method: "GET",
      },
      async () => new Response(body),
    );

    expect(response.body).toBeUndefined();
    expect(canceled).toBe(true);
  });

  test("should cancel an unused response body before download progress", async () => {
    let canceled = false;
    const onProgress = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.close();
      },
      cancel() {
        canceled = true;
      },
    });

    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        downloadProgress: onProgress,
        endpoint: "/unused",
        method: "GET",
      },
      async () => new Response(body),
    );

    expect(response.body).toBeUndefined();
    expect(canceled).toBe(true);
    expect(onProgress).not.toHaveBeenCalled();
  });

  test.each(["json", "text"] as const)(
    "should consume an explicit %s response without canceling it",
    async (responseType) => {
      let canceled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":1}'));
          controller.close();
        },
        cancel() {
          canceled = true;
        },
      });

      const response = await fetchHandler(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/explicit",
          method: "GET",
          responseType,
        },
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json" },
          }),
      );

      expect(response.body).toEqual(
        responseType === "json" ? { id: 1 } : '{"id":1}',
      );
      expect(canceled).toBe(false);
    },
  );

  test("should ignore an unsupported runtime response type", async () => {
    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/unsupported",
        method: "GET",
        responseType: "unsupported" as HttpRequest["responseType"],
      },
      async () => new Response("ignored"),
    );

    expect(response.body).toBeNull();
  });

  test("should ignore an unused response body cancellation failure", async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    });

    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/unused",
        method: "GET",
      },
      async () => new Response(body),
    );

    expect(response.body).toBeUndefined();
  });

  test("should not wait for unused response body cancellation to settle", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ cancel });

    const response = await settleWithin(
      fetchHandler(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/unused",
          method: "GET",
        },
        async () => new Response(body),
      ),
    );

    expect(response.body).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("should cancel and unlock a progress response when the async observer rejects", async () => {
    const observerError = new Error("observer failed");
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      },
    });

    const pending = fetchHandler(
      {
        baseEndpoint: "https://example.com",
        async downloadProgress() {
          await Promise.resolve();
          throw observerError;
        },
        endpoint: "/progress-error",
        method: "GET",
        responseType: "text",
      },
      async () => new Response(body),
    );

    await expect(settleWithin(pending)).rejects.toMatchObject({
      cause: observerError,
      code: "EXT_OBSERVER_FAILED",
    });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(observerError);
    expect(body.locked).toBe(false);
  });

  test("should return a response error when reading a body fails without progress", async () => {
    const readError = new Error("read failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(readError);
      },
    });

    const failure = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/read-error",
        method: "GET",
        responseType: "text",
      },
      async () => new Response(body),
    ).catch((cause: unknown) => cause);

    expect(failure).toMatchObject({
      cause: readError,
      code: "NET_BODY_INCOMPLETE",
    });
    expect(body.locked).toBe(false);
  });

  test("should response is null when responseType is not set", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
    };

    const { body } = await fetchHandler(requestConfig);
    expect(body).toBeUndefined();
  });

  test("should abort network", async () => {
    const abort = new AbortController();
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/delay",
      method: "GET",
      abort: abort.signal,
      queryParams: new URLSearchParams({ ms: "5000" }),
    };

    setTimeout(() => {
      abort.abort();
    }, 0);

    await expect(fetchHandler(requestConfig)).rejects.toBe(ERR_ABORTED);
  });

  test("should settle an ignored fetch abort and cancel a late response body", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: "https://example.com",
        endpoint: "/ignored-abort",
        method: "GET",
        responseType: "text",
      },
      fetchMock as unknown as typeof fetch,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED);
    resolveFetch(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await vi.waitFor(() =>
      expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason),
    );
  });

  test("should abort a stalled response body read without waiting for cancellation", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    let startPull!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      startPull = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull() {
          startPull();
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: "https://example.com",
        endpoint: "/stalled-body",
        method: "GET",
        responseType: "text",
      },
      async () => new Response(body),
    );

    await pullStarted;
    controller.abort();

    await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason);
    expect(body.locked).toBe(false);
  });

  test("should abort a stalled response body read when cancellation rejects", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    let startPull!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      startPull = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull() {
          startPull();
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: "https://example.com",
        endpoint: "/stalled-body-cancel-rejects",
        method: "GET",
        responseType: "text",
      },
      async () => new Response(body),
    );

    await pullStarted;
    controller.abort();

    await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason);
    expect(body.locked).toBe(false);
  });

  test("should abort a stalled progress response body read without waiting for cancellation", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    let startPull!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      startPull = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull() {
          startPull();
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: "https://example.com",
        downloadProgress: vi.fn(),
        endpoint: "/stalled-progress-body",
        method: "GET",
        responseType: "text",
      },
      async () => new Response(body),
    );

    await pullStarted;
    controller.abort();

    await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason);
    expect(body.locked).toBe(false);
  });

  test("should timeout network", async () => {
    const signal = AbortSignal.timeout(100);
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/delay",
      method: "GET",
      abort: signal,
      queryParams: new URLSearchParams({ ms: "10000" }),
    };

    await expect(fetchHandler(requestConfig)).rejects.toBe(ERR_TIMEOUT);
  });

  test("should return error when get request set body", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/delay",
      method: "GET",
      body: "Hello World!",
    };

    await expect(fetchHandler(requestConfig)).rejects.toBeInstanceOf(Error);
  });

  test("should parse json text arraybuffer and blob bodies", async () => {
    const jsonRequest: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
      responseType: "json",
    };
    const textRequest: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
      responseType: "text",
    };
    const arrayBufferRequest: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
      responseType: "arraybuffer",
    };
    const blobRequest: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
      responseType: "blob",
    };

    await expect(
      fetchHandler(jsonRequest).then((response) => response.body),
    ).resolves.toEqual({ id: 1 });
    await expect(
      fetchHandler(textRequest).then((response) => response.body),
    ).resolves.toEqual(JSON.stringify({ id: 1 }));
    await expect(
      fetchHandler(arrayBufferRequest).then((response) => response.body),
    ).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(
      fetchHandler(blobRequest).then((response) => response.body),
    ).resolves.toBeInstanceOf(Blob);
  });

  test("should expose non-2xx status without a synthetic response error", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/500",
      method: "GET",
      responseType: "text",
    };

    const response = await fetchHandler(requestConfig);
    expect(response.ok).toBe(false);
  });

  test("should reject when need json but return text", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/text",
      method: "GET",
      responseType: "json",
    };

    await expect(fetchHandler(requestConfig)).rejects.toBeInstanceOf(Error);
  });

  test("should call downloadProgress", async () => {
    let called = false;
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
      responseType: "text",
      downloadProgress: () => {
        called = true;
      },
    };

    await fetchHandler(requestConfig);
    expect(called).toBeTruthy();
  });

  test("should parse body throw error", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/",
      method: "POST",
      responseType: "json",
      body: "hello",
    };

    await expect(fetchHandler(requestConfig)).rejects.toBeInstanceOf(Error);
  });

  test("should keep explicit accept header", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/",
      method: "POST",
      responseType: "json",
      headers: new Headers([["Accept", "application/json"]]),
      body: { id: 1 },
    };

    await expect(fetchHandler(requestConfig)).resolves.not.toThrowError();
  });

  test("should keep response body null for head requests", async () => {
    const requestConfig: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/head",
      method: "HEAD",
    };

    const res = await fetchHandler(requestConfig);
    expect(res.body).toBeUndefined();
  });

  test("should fill an empty native Response url from the resolved request URL", async () => {
    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/filled",
        method: "GET",
        responseType: "json",
      },
      async () =>
        new Response(JSON.stringify({ id: 1 }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    );

    expect(response.url).toBe("https://example.com/filled");
    expect(response.body).toEqual({ id: 1 });
  });

  test("should store an absent stream as undefined and a parsed JSON null as null", async () => {
    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/null",
      method: "GET",
      responseType: "json" as const,
    };
    const headers = { "content-type": "application/json" };
    const absent = await fetchHandler(
      request,
      async () => new Response(null, { headers, status: 200 }),
    );
    const parsedNull = await fetchHandler(
      request,
      async () => new Response("null", { headers, status: 200 }),
    );

    expect(absent.body).toBeUndefined();
    expect(parsedNull.body).toBeNull();
  });

  test("should reject a present zero-length JSON body", async () => {
    await expect(
      fetchHandler(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/empty",
          method: "GET",
          responseType: "json",
        },
        async () =>
          new Response("", {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
      ),
    ).rejects.toMatchObject({ code: "RES_DECODE_FAILED" });
  });
});

function settleWithin<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("operation did not settle")),
      100,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
