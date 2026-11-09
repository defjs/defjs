import { vi } from "vitest";
import { __resetStreamingRequestBodySupportForTests } from "../src/http/transport/fetch_init.ts";

// A runtime with stream request bodies keeps the stream on Request. Firefox has none.
export function installStreamingRequestShim(): void {
  const PlatformRequest = globalThis.Request;

  class StreamingRequest extends PlatformRequest {
    #stream: ReadableStream<Uint8Array<ArrayBuffer>> | null = null;

    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const body = init?.body;
      const stream = body instanceof ReadableStream ? body : undefined;
      super(input, stream === undefined ? init : { ...init, body: undefined });
      this.#stream = stream ?? null;
    }

    override get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
      return this.#stream ?? super.body;
    }

    override arrayBuffer(): Promise<ArrayBuffer> {
      if (this.#stream === null) {
        return super.arrayBuffer();
      }
      return new Response(this.#stream).arrayBuffer();
    }
  }

  vi.stubGlobal("Request", StreamingRequest);
  __resetStreamingRequestBodySupportForTests();
}
