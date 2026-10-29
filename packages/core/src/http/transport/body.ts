import type { HttpRequest } from "../../internal/http_request";
import {
  isBlob,
  isFormData,
  isReadableStream,
  isURLSearchParams,
} from "../../internal/type_guards";

const BODY_CONTENT_TYPE_SOURCE = "bodyContentTypeSource";

export function serializeHttpBody(
  body: HttpRequest["body"],
):
  | ArrayBuffer
  | Uint8Array<ArrayBuffer>
  | Blob
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>
  | string
  | null {
  switch (true) {
    case isFormData(body):
    case isBlob(body):
    case body instanceof ArrayBuffer:
    case isURLSearchParams(body):
    case isReadableStream(body):
    case typeof body === "string":
      return body;
    case ArrayBuffer.isView(body):
      // DOM BodyInit excludes SharedArrayBuffer views; the value itself is unchanged.
      return body as Uint8Array<ArrayBuffer>;
    case typeof body === "object":
    case typeof body === "boolean":
    case typeof body === "number":
    case Array.isArray(body):
      return JSON.stringify(body);
    default:
      return null;
  }
}

export function applyRequestContentType(
  request: HttpRequest,
  headers: Headers,
): void {
  const body = request.body;
  if (isFormData(body)) {
    headers.delete("Content-Type");
    return;
  }
  // An explicit header always wins. HTTP never stores inferred types in headers, so a header is a declaration.
  if (body === undefined || headers.has("Content-Type")) {
    return;
  }
  // bodyContentType describes the body the builder produced; a replaced body is detected again.
  const sameBody =
    !Object.hasOwn(request, BODY_CONTENT_TYPE_SOURCE) ||
    request.bodyContentTypeSource === body;
  const contentType =
    sameBody && request.bodyContentType !== undefined
      ? request.bodyContentType
      : resolveHttpBodyContentType(body);
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
}

export function resolveHttpBodyContentType(
  body: HttpRequest["body"],
): string | null {
  switch (true) {
    case isFormData(body):
      return null;
    case body instanceof ArrayBuffer:
    case ArrayBuffer.isView(body):
      return "application/octet-stream";
    case isBlob(body):
      return body.type || "application/octet-stream";
    case isURLSearchParams(body):
      return "application/x-www-form-urlencoded;charset=UTF-8";
    case isReadableStream(body):
      return "application/octet-stream";
    case typeof body === "string":
      return "text/plain;charset=UTF-8";
    case body === null:
    case typeof body === "object" && body !== null:
    case typeof body === "number":
    case typeof body === "boolean":
      return "application/json";
    default:
      return null;
  }
}
