import { encodeOutbound, encodeTaggedObject } from "../struct/encode";
import { isObjectRuntimeStruct } from "../struct/guards";
import { isGuideSet, readOwnGuide, type Guide } from "../struct/guide";
import { DEFINITION } from "../struct/symbols";
import type { ObjectRuntimeStruct } from "../struct/definition";
import { isPlainObject } from "../struct/plain_object";
import {
  isBlob,
  isFormData,
  isReadableStream,
  isURLSearchParams,
} from "./type_guards";

export type OutboundTransport = "http" | "sse" | "webSocket";

/** Accepts any concrete builder. `never` keeps the parameter contravariant. */
export type OutboundBuilder = (input: never) => unknown;

export type MaterializedRequest = {
  body?: object | string;
  defaultContentType?: string;
  headers?: Headers;
  params?: { [key: string]: string };
  query?: URLSearchParams | { [key: string]: unknown };
};

type FormCodec = "formData" | "urlencoded";

type FormTarget = {
  append(key: string, value: string): void;
};

export function runOutboundBuilder(
  input: unknown,
  builder: OutboundBuilder | undefined,
  inputDeclared = input !== undefined,
): unknown {
  if (builder === undefined) {
    if (inputDeclared) {
      throw new TypeError(
        "An endpoint with input requires an explicit builder",
      );
    }
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the published OutboundBuilder type, `(input: never) => unknown` in RequestDefinition, EventStreamDefinition and WebSocketDefinition, erases each builder's parameter, so no value can be passed to it unasserted (TS2345, `unknown` is not assignable to `never`). Keeping each definition's own `(input: BuilderInput<TInput>) => …` type would need ParsedInput<TInput> to relate to BuilderInput<TInput>, two conditionals on the caller's generic
  return builder(input as never);
}

export function materializeOutboundRequest(
  shape: unknown,
  transport: OutboundTransport,
  guides?: WeakMap<object, Guide>,
): MaterializedRequest {
  if (!isPlainObject(shape)) {
    throw new TypeError("builder must return an object");
  }

  if (transport === "webSocket") {
    if (shape["headers"] !== undefined) {
      throw new TypeError("WebSocket request does not support headers");
    }
    if (shape["body"] !== undefined) {
      throw new TypeError("WebSocket request does not support body");
    }
  }

  const request: MaterializedRequest = {};
  if (shape["path"] !== undefined) {
    request.params = materializePath(shape["path"], guides);
  }
  if (shape["query"] !== undefined) {
    request.query = materializeQuery(shape["query"], guides);
  }
  if (shape["headers"] !== undefined) {
    request.headers = materializeHeaders(shape["headers"], guides);
  }
  if (shape["body"] !== undefined) {
    const body = materializeBody(shape["body"], guides);
    request.body = body.body;
    request.defaultContentType = body.defaultContentType;
  }
  return request;
}

function materializePath(
  value: unknown,
  guides?: WeakMap<object, Guide>,
): { [key: string]: string } {
  const encoded = encodeOutbound(value, guides);
  if (!isPlainObject(encoded)) {
    throw new TypeError("path value must be an object");
  }

  // Ordinary `{}` assignment treats "__proto__" as the prototype setter and drops the key, so the record has none.
  const params: { [key: string]: string } = {};
  Object.setPrototypeOf(params, null);
  for (const [key, item] of Object.entries(encoded)) {
    if (item === null) {
      throw new TypeError(`path value for "${key}" must not be null`);
    }
    if (
      !isPrimitive(item) &&
      item !== undefined &&
      typeof item !== "function"
    ) {
      throw new TypeError(`path value for "${key}" must be a scalar`);
    }
    // Every other value, including a symbol, a function or undefined, is converted with String().
    params[key] = String(item);
  }
  return params;
}

function materializeQuery(
  value: unknown,
  guides?: WeakMap<object, Guide>,
): URLSearchParams | { [key: string]: unknown } {
  if (isURLSearchParams(value)) {
    return value;
  }

  const encoded = encodeOutbound(value, guides);
  if (!isPlainObject(encoded)) {
    throw new TypeError("query value must be an object or URLSearchParams");
  }
  rejectNullValues(encoded, "query");
  return encoded;
}

function materializeHeaders(
  value: unknown,
  guides?: WeakMap<object, Guide>,
): Headers {
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return value;
  }
  if (Array.isArray(value)) {
    // Fetch decides which entries are valid and what throws. Narrowing them by hand would be a rule set of its own:
    // it would read the entry "ab" as a: b and a one-item entry as "undefined", where Headers throws.
    return new Headers(value);
  }

  const encoded = encodeOutbound(value, guides);
  if (!isPlainObject(encoded)) {
    throw new TypeError("headers value must be a header record or HeadersInit");
  }
  // String() leaves the conversion to JavaScript: null becomes "null" and an array joins with a comma. Encoding turns
  // a nested object into a null-prototype one, so converting it throws a TypeError.
  return new Headers(
    Object.entries(encoded).map(([key, item]) => [key, String(item)]),
  );
}

function materializeBody(
  body: unknown,
  guides?: WeakMap<object, Guide>,
): {
  body?: object | string;
  defaultContentType?: string;
} {
  const codecBody = codecBodyOf(body, guides);
  if (codecBody) {
    return { body: encodeCodecBody(codecBody, guides) };
  }
  if (
    isFormData(body) ||
    isURLSearchParams(body) ||
    isBlob(body) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    isReadableStream(body)
  ) {
    return { body };
  }
  // Classify the builder value. Date and bigint encode to strings and still belong to JSON.
  if (typeof body === "string") {
    return { body };
  }

  return {
    body: JSON.stringify(encodeOutbound(body, guides), rejectNonJson),
    defaultContentType: "application/json",
  };
}

// JSON.stringify drops a function or symbol, writes NaN and Infinity as null, and turns a Map, Set, stream or
// class instance into `{}`. The replacer sees each value after toJSON, so what is still not JSON data is rejected.
// HTTP JSON bodies and WebSocket text frames share this guard.
export function rejectNonJson(
  key: string,
  value: unknown,
  source: "body" | "Outgoing WebSocket message" = "body",
): unknown {
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    (typeof value === "number" && !Number.isFinite(value)) ||
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !isPlainObject(value))
  ) {
    const kind =
      typeof value === "number"
        ? String(value)
        : typeof value === "object"
          ? value?.constructor?.name ||
            Object.prototype.toString.call(value).slice(8, -1)
          : typeof value;
    const advice =
      source === "body"
        ? "Send JSON data, a string, bytes, Blob, FormData, URLSearchParams or a Web ReadableStream (ReadableStream.from(iterable), Readable.toWeb(readable))."
        : "Send JSON data.";
    throw new TypeError(
      `${source}${key ? ` field "${key}"` : ""} is not JSON data: ${kind}. ${advice}`,
    );
  }
  return value;
}

function encodeCodecBody(
  { body, codec, struct }: CodecBody,
  guides?: WeakMap<object, Guide>,
): FormData | URLSearchParams {
  // The object struct that selected the codec is the body's own guide.
  const encoded = encodeTaggedObject(body, struct, guides);
  if (codec === "formData") {
    const form = new FormData();
    for (const [key, value] of Object.entries(encoded)) {
      appendFormValue(form, key, value, codec);
    }
    return form;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(encoded)) {
    appendFormValue(params, key, value, codec);
  }
  return params;
}

function appendFormValue(
  target: FormTarget,
  key: string,
  value: unknown,
  codec: FormCodec,
): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormValue(target, key, item, codec);
    }
    return;
  }
  // Only the formData codec appends to a FormData target.
  if (isFormData(target) && isBlob(value)) {
    target.append(key, value);
    return;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    target.append(key, String(value));
    return;
  }
  throw new TypeError(`${codec} field "${key}" does not support nested values`);
}

function rejectNullValues(
  value: { [key: string]: unknown },
  section: string,
): void {
  for (const [key, item] of Object.entries(value)) {
    rejectNullValue(item, key, section);
  }
}

function rejectNullValue(value: unknown, key: string, section: string): void {
  if (value === null) {
    throw new TypeError(`${section} value for "${key}" must not be null`);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectNullValue(item, key, section);
    }
    return;
  }
  if (isPlainObject(value)) {
    rejectNullValues(value, section);
  }
}

type CodecBody = {
  body: { [key: string]: unknown };
  codec: FormCodec;
  struct: ObjectRuntimeStruct;
};

function codecBodyOf(
  value: unknown,
  guides?: WeakMap<object, Guide>,
): CodecBody | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const guide = readOwnGuide(value, guides);
  if (
    guide === undefined ||
    isGuideSet(guide) ||
    !isObjectRuntimeStruct(guide)
  ) {
    return undefined;
  }
  const codec = guide[DEFINITION].codec;
  return codec === undefined
    ? undefined
    : { body: value, codec, struct: guide };
}

/** A value that is neither null, undefined, an object nor a function. */
function isPrimitive(
  value: unknown,
): value is bigint | boolean | number | string | symbol {
  return (
    value !== null &&
    value !== undefined &&
    typeof value !== "object" &&
    typeof value !== "function"
  );
}
