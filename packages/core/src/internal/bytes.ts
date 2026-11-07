import type { HttpRequest } from "./http_request";

const textDecoder = new TextDecoder();

export function decodeBytes(value: ArrayBuffer | ArrayBufferView): string {
  return textDecoder.decode(value);
}

export function readBytesText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return decodeBytes(value);
  }
  return undefined;
}

/** The bytes of `content` as a buffer. A view over a SharedArrayBuffer keeps its shared storage. */
export function toArrayBuffer(content: Uint8Array): ArrayBufferLike {
  const { buffer, byteLength, byteOffset } = content;
  if (
    buffer instanceof ArrayBuffer &&
    byteOffset === 0 &&
    byteLength === buffer.byteLength
  ) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

export function parseBytesBody(
  responseType: HttpRequest["responseType"],
  content: Uint8Array<ArrayBuffer>,
  contentType: string,
): unknown {
  switch (responseType) {
    case "json":
      return JSON.parse(decodeBytes(content));
    case "text":
      return decodeBytes(content);
    case "blob":
      return new Blob([content], { type: contentType });
    case "arraybuffer":
      return toArrayBuffer(content);
    default:
      return null;
  }
}

export function concatChunks(
  chunks: Uint8Array[],
  totalLength: number,
): Uint8Array<ArrayBuffer> {
  const chunksAll = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    chunksAll.set(chunk, position);
    position += chunk.length;
  }
  return chunksAll;
}
