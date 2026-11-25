import type {
  PortClientOptions,
  PortWebSocketHandle,
  PortWebSocketHandleConstructor,
} from "../types";
import type { PortMux } from "./mux";
import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  concatChunks,
  decodeWirePayload,
  encodeWirePayload,
  resolveWireMode,
  sliceChunks,
  validatePositiveInt,
} from "./protocol";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const textEncoder = new TextEncoder();

function ignoreError(): void {}

export function createPortWebSocketConstructor(
  mux: PortMux,
  options?: PortClientOptions,
): PortWebSocketHandleConstructor {
  const chunkSize = validatePositiveInt(
    "chunkSize",
    options?.chunkSize ?? DEFAULT_CHUNK_SIZE,
    MAX_CHUNK_SIZE,
  );
  const mode = resolveWireMode(options?.mode, mux.defaultMode);

  class PortWebSocket extends EventTarget implements PortWebSocketHandle {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSING = CLOSING;
    static readonly CLOSED = CLOSED;

    readonly url: string;
    protocol = "";
    extensions = "";
    bufferedAmount = 0;
    binaryType: BinaryType = "blob";

    #readyState = CONNECTING;
    #channelId: number | undefined;
    #incomingChunks: Uint8Array[] = [];
    #sendChain: Promise<void> | undefined;

    constructor(url: string | URL, protocols?: string | string[]) {
      super();
      this.url = typeof url === "string" ? url : url.href;
      const requestedProtocols =
        protocols === undefined
          ? []
          : typeof protocols === "string"
            ? [protocols]
            : [...protocols];

      try {
        const channelId = mux.openChannel({
          onDisconnect: (reason) => {
            this.#finishUnexpected(reason);
          },
          onFrame: (frame) => {
            switch (frame.kind) {
              case "ws.opened": {
                if (this.#readyState !== CONNECTING) {
                  return;
                }
                this.protocol = frame.protocol;
                this.extensions = frame.extensions;
                this.#readyState = OPEN;
                this.dispatchEvent(new Event("open"));
                return;
              }
              case "ws.message": {
                if (this.#readyState !== OPEN) {
                  return;
                }
                if (frame.dataType === "text") {
                  this.dispatchEvent(
                    new MessageEvent("message", { data: frame.data }),
                  );
                  return;
                }
                const chunk = decodeWirePayload(frame.data);
                if (chunk === undefined) {
                  this.#failCorruptFrame(channelId);
                  return;
                }
                this.#incomingChunks.push(chunk);
                if (!frame.done) {
                  return;
                }
                const assembled = concatChunks(this.#incomingChunks);
                this.#incomingChunks = [];
                const data =
                  this.binaryType === "arraybuffer"
                    ? assembled.buffer
                    : new Blob([assembled]);
                this.dispatchEvent(new MessageEvent("message", { data }));
                return;
              }
              case "ws.error": {
                this.dispatchEvent(new Event("error"));
                return;
              }
              case "ws.closed": {
                this.#closeLocally(frame.code, frame.reason, frame.wasClean);
                return;
              }
              default:
                return;
            }
          },
        });
        this.#channelId = channelId;
        mux.send({
          v: 1,
          id: channelId,
          kind: "ws.open",
          url: this.url,
          protocols: requestedProtocols,
        });
      } catch (error) {
        if (this.#channelId !== undefined) {
          mux.deleteChannel(this.#channelId);
          this.#channelId = undefined;
        }
        const reason = error instanceof Error ? error.message : String(error);
        queueMicrotask(() => {
          this.#finishUnexpected(reason);
        });
      }
    }

    get readyState(): number {
      return this.#readyState;
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.#readyState === CONNECTING) {
        throw new DOMException(
          "The socket is still connecting",
          "InvalidStateError",
        );
      }
      if (this.#readyState !== OPEN || this.#channelId === undefined) {
        return;
      }
      const channelId = this.#channelId;
      if (typeof data === "string") {
        this.#runOrdered(() => {
          this.#sendText(channelId, data);
        });
        return;
      }
      if (data instanceof Blob) {
        const size = data.size;
        this.bufferedAmount += size;
        const next = (this.#sendChain ?? Promise.resolve()).then(async () => {
          try {
            const buffer = await data.arrayBuffer();
            if (this.#readyState === OPEN && this.#channelId === channelId) {
              this.#sendBinary(channelId, new Uint8Array(buffer));
            }
          } finally {
            this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
          }
        });
        const tracked: Promise<void> = next.catch(ignoreError).then(() => {
          if (this.#sendChain === tracked) {
            this.#sendChain = undefined;
          }
        });
        this.#sendChain = tracked;
        return;
      }
      const bytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      this.#runOrdered(() => {
        this.#sendBinary(channelId, bytes);
      });
    }

    close(code?: number, reason?: string): void {
      if (
        code !== undefined &&
        code !== 1000 &&
        !(code >= 3000 && code <= 4999)
      ) {
        throw new DOMException(
          "The close code is not allowed",
          "InvalidAccessError",
        );
      }
      if (reason !== undefined && textEncoder.encode(reason).byteLength > 123) {
        throw new DOMException("The close reason is too long", "SyntaxError");
      }
      if (this.#readyState === CLOSING || this.#readyState === CLOSED) {
        return;
      }
      this.#readyState = CLOSING;
      if (this.#channelId !== undefined) {
        mux.trySend({
          v: 1,
          id: this.#channelId,
          kind: "ws.close",
          code,
          reason,
        });
      }
    }

    #runOrdered(fn: () => void): void {
      if (this.#sendChain === undefined) {
        fn();
        return;
      }
      const tracked: Promise<void> = this.#sendChain
        .then(() => {
          if (this.#readyState === OPEN) {
            fn();
          }
        })
        .catch(ignoreError);
      const reset: Promise<void> = tracked.then(() => {
        if (this.#sendChain === reset) {
          this.#sendChain = undefined;
        }
      });
      this.#sendChain = reset;
    }

    #sendText(channelId: number, data: string): void {
      mux.send({
        v: 1,
        id: channelId,
        kind: "ws.send",
        dataType: "text",
        data,
        done: true,
      });
    }

    #sendBinary(channelId: number, bytes: Uint8Array): void {
      const pieces = [...sliceChunks(bytes, chunkSize)];
      const lastIndex = pieces.length - 1;
      for (const [index, piece] of pieces.entries()) {
        const encoded = encodeWirePayload(piece, mode);
        mux.send(
          {
            v: 1,
            id: channelId,
            kind: "ws.send",
            dataType: "binary",
            data: encoded.payload,
            done: index === lastIndex,
          },
          encoded.transfer,
        );
      }
    }

    #failCorruptFrame(channelId: number): void {
      this.dispatchEvent(new Event("error"));
      mux.trySend({
        v: 1,
        id: channelId,
        kind: "ws.close",
        code: 1002,
        reason: "Invalid binary frame",
      });
      this.#closeLocally(1002, "Invalid binary frame", false);
    }

    #finishUnexpected(reason: string): void {
      this.dispatchEvent(new Event("error"));
      this.#closeLocally(1006, reason, false);
    }

    #closeLocally(code: number, reason: string, wasClean: boolean): void {
      this.#readyState = CLOSED;
      this.#incomingChunks = [];
      if (this.#channelId !== undefined) {
        mux.deleteChannel(this.#channelId);
        this.#channelId = undefined;
      }
      this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean }));
    }
  }

  return PortWebSocket;
}
