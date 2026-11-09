import { expect, inject, test, vi } from "vitest";
import { registerUploadObserverSuite } from "../../test/suites/upload-observer.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";
import { createClient, withEndpoint } from "../client/index.ts";
import { defineRequest } from "./index.ts";

registerUploadObserverSuite(uploadCapabilities.chrome);

async function collectUnhandledRejections<T>(
  run: () => Promise<T>,
): Promise<{ reasons: unknown[]; result: T }> {
  const reasons: unknown[] = [];
  const sentinel = new Error("flush unhandled rejections");
  let markFlushed: () => void = () => undefined;
  const flushed = new Promise<void>((resolve) => {
    markFlushed = resolve;
  });
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    if (event.reason === sentinel) {
      markFlushed();
      return;
    }
    reasons.push(event.reason);
  };
  // Vitest's own listener logs each event once a test registers one of its own.
  const silence = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  window.addEventListener("unhandledrejection", onRejection);
  try {
    const result = await run();
    // Rejections are reported in order, so the sentinel's event proves every earlier one has arrived.
    void Promise.reject(sentinel);
    await flushed;
    return { reasons, result };
  } finally {
    window.removeEventListener("unhandledrejection", onRejection);
    silence.mockRestore();
  }
}

test("should not leave an unhandled rejection after a later upload chunk observer fails", async () => {
  const cause = new Error("chunk observer failed");
  let calls = 0;
  const client = createClient(withEndpoint(inject("testServerHost")));
  const upload = defineRequest({
    builder: () => ({ body: new Blob(["hello-upload"]) }),
    method: "POST",
    path: "/body/upload",
  });

  const { reasons, result } = await collectUnhandledRejections(() =>
    upload(
      client({
        onUploadProgress() {
          calls += 1;
          if (calls > 1) throw cause;
        },
      }),
    ),
  );

  expect(reasons).toEqual([]);
  expect(result[0]?.code).toBe("EXT_OBSERVER_FAILED");
  expect(result[0]?.cause).toBe(cause);
});

test.each([
  { label: "with", options: { onUploadProgress: () => undefined } },
  { label: "without", options: {} },
])(
  "should not leave an unhandled rejection when the source stream errors $label an upload observer",
  async ({ options }) => {
    const cause = new Error("source stream failed");
    const client = createClient(withEndpoint(inject("testServerHost")));
    const upload = defineRequest({
      builder: () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(cause);
          },
        }),
      }),
      method: "POST",
      path: "/body/upload",
    });

    const { reasons, result } = await collectUnhandledRejections(() =>
      upload(client(options)),
    );

    expect(reasons).toEqual([]);
    expect(result[0]?.code).toBe("NET_UNREACHABLE");
  },
);

test.each([
  { label: "with", options: { onUploadProgress: () => undefined } },
  { label: "without", options: {} },
])(
  "should still cancel the source of an upload the platform rejects over HTTP/1.1 $label an upload observer",
  async ({ options }) => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const client = createClient(withEndpoint(inject("testServerHost")));
    const upload = defineRequest({
      builder: () => ({ body: source }),
      method: "POST",
      path: "/body/upload",
    });

    const [error] = await upload(client(options));

    expect(error?.code).toBe("NET_UNREACHABLE");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  },
);
