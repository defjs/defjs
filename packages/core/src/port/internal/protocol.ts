import type { PortWireMode } from "../types";

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_CHUNK_SIZE = 262_144;
export const MAX_CHUNK_SIZE = 1_048_576;
export const DEFAULT_CREDIT_WINDOW = 8;
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 33_554_432;

export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

export type HeaderPair = readonly [string, string];
export type WirePayload = Uint8Array | string;

export type PortFrame =
  | { readonly v: 1; readonly id: 0; readonly kind: "port.close" }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "http.open";
      readonly url: string;
      readonly method: string;
      readonly headers: readonly HeaderPair[];
      readonly credentials?: RequestCredentials;
      readonly hasBody: boolean;
      readonly credits: number;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "http.body";
      readonly chunk?: WirePayload;
      readonly done: boolean;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "http.pull";
      readonly credits: number;
    }
  | { readonly v: 1; readonly id: number; readonly kind: "http.abort" }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "http.head";
      readonly status: number;
      readonly statusText: string;
      readonly headers: readonly HeaderPair[];
      readonly url: string;
      readonly hasBody: boolean;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "http.chunk";
      readonly chunk: WirePayload;
    }
  | { readonly v: 1; readonly id: number; readonly kind: "http.end" }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "http.error";
      readonly message: string;
      readonly name?: string;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.open";
      readonly url: string;
      readonly protocols: readonly string[];
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.opened";
      readonly protocol: string;
      readonly extensions: string;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.send";
      readonly dataType: "text" | "binary";
      readonly data: string | WirePayload;
      readonly done: boolean;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.message";
      readonly dataType: "text" | "binary";
      readonly data: string | WirePayload;
      readonly done: boolean;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.close";
      readonly code?: number;
      readonly reason?: string;
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.error";
    }
  | {
      readonly v: 1;
      readonly id: number;
      readonly kind: "ws.closed";
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;
    };

export function validatePositiveInt(
  name: string,
  value: number,
  max?: number,
): number {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    (max !== undefined && value > max)
  ) {
    throw new RangeError(
      max === undefined
        ? `${name} must be a positive integer`
        : `${name} must be an integer between 1 and ${max}`,
    );
  }
  return value;
}

const BASE64_SLICE = 0x8000;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += BASE64_SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_SLICE));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function encodeWirePayload(
  bytes: Uint8Array,
  mode: PortWireMode,
): { payload: WirePayload; transfer?: Transferable[] } {
  if (mode === "json") {
    return { payload: encodeBase64(bytes) };
  }
  const owned = new Uint8Array(bytes);
  return { payload: owned, transfer: [owned.buffer] };
}

export function decodeWirePayload(
  payload: WirePayload,
): Uint8Array<ArrayBuffer> | undefined {
  if (typeof payload === "string") {
    try {
      return decodeBase64(payload);
    } catch {
      return undefined;
    }
  }
  return new Uint8Array(payload);
}

export function* sliceChunks(
  bytes: Uint8Array,
  chunkSize: number,
): Generator<Uint8Array> {
  if (bytes.byteLength <= chunkSize) {
    yield bytes;
    return;
  }
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.subarray(offset, offset + chunkSize);
  }
}

export function concatChunks(
  chunks: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isWirePayload(value: unknown): value is WirePayload {
  return typeof value === "string" || value instanceof Uint8Array;
}

function readStringPairs(value: unknown): readonly HeaderPair[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: HeaderPair[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) {
      return undefined;
    }
    const name: unknown = item[0];
    const val: unknown = item[1];
    if (typeof name !== "string" || typeof val !== "string") {
      return undefined;
    }
    out.push([name, val]);
  }
  return out;
}

function readStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return undefined;
    }
    out.push(item);
  }
  return out;
}

function readCredentials(value: unknown): RequestCredentials | undefined {
  if (value === "omit" || value === "same-origin" || value === "include") {
    return value;
  }
  return undefined;
}

export function parseFrame(raw: unknown): PortFrame | undefined {
  if (!isRecord(raw) || raw["v"] !== PROTOCOL_VERSION) {
    return undefined;
  }
  const id = raw["id"];
  const kind = raw["kind"];
  if (typeof kind !== "string") {
    return undefined;
  }
  if (kind === "port.close") {
    return id === 0 ? { v: 1, id: 0, kind: "port.close" } : undefined;
  }
  if (!isPositiveInt(id)) {
    return undefined;
  }
  switch (kind) {
    case "http.open": {
      const url = raw["url"];
      const method = raw["method"];
      const headers = readStringPairs(raw["headers"]);
      const hasBody = raw["hasBody"];
      const credits = raw["credits"];
      if (
        typeof url !== "string" ||
        typeof method !== "string" ||
        headers === undefined ||
        typeof hasBody !== "boolean" ||
        !isPositiveInt(credits)
      ) {
        return undefined;
      }
      return {
        v: 1,
        id,
        kind,
        url,
        method,
        headers,
        credentials: readCredentials(raw["credentials"]),
        hasBody,
        credits,
      };
    }
    case "http.body": {
      const done = raw["done"];
      const chunk = raw["chunk"];
      if (
        typeof done !== "boolean" ||
        (chunk !== undefined && !isWirePayload(chunk))
      ) {
        return undefined;
      }
      return { v: 1, id, kind, chunk, done };
    }
    case "http.pull": {
      const credits = raw["credits"];
      return isPositiveInt(credits) ? { v: 1, id, kind, credits } : undefined;
    }
    case "http.abort":
    case "http.end":
    case "ws.error":
      return { v: 1, id, kind };
    case "http.head": {
      const status = raw["status"];
      const statusText = raw["statusText"];
      const headers = readStringPairs(raw["headers"]);
      const url = raw["url"];
      const hasBody = raw["hasBody"];
      if (
        typeof status !== "number" ||
        !Number.isInteger(status) ||
        typeof statusText !== "string" ||
        headers === undefined ||
        typeof url !== "string" ||
        typeof hasBody !== "boolean"
      ) {
        return undefined;
      }
      return { v: 1, id, kind, status, statusText, headers, url, hasBody };
    }
    case "http.chunk": {
      const chunk = raw["chunk"];
      return isWirePayload(chunk) ? { v: 1, id, kind, chunk } : undefined;
    }
    case "http.error": {
      const message = raw["message"];
      const name = raw["name"];
      if (
        typeof message !== "string" ||
        (name !== undefined && typeof name !== "string")
      ) {
        return undefined;
      }
      return { v: 1, id, kind, message, name };
    }
    case "ws.open": {
      const url = raw["url"];
      const protocols = readStringList(raw["protocols"]);
      if (typeof url !== "string" || protocols === undefined) {
        return undefined;
      }
      return { v: 1, id, kind, url, protocols };
    }
    case "ws.opened": {
      const protocol = raw["protocol"];
      const extensions = raw["extensions"];
      if (typeof protocol !== "string" || typeof extensions !== "string") {
        return undefined;
      }
      return { v: 1, id, kind, protocol, extensions };
    }
    case "ws.send":
    case "ws.message": {
      const dataType = raw["dataType"];
      const data = raw["data"];
      const done = raw["done"];
      if (typeof done !== "boolean") {
        return undefined;
      }
      if (dataType === "text" && typeof data === "string") {
        return { v: 1, id, kind, dataType, data, done };
      }
      if (dataType === "binary" && isWirePayload(data)) {
        return { v: 1, id, kind, dataType, data, done };
      }
      return undefined;
    }
    case "ws.close": {
      const code = raw["code"];
      const reason = raw["reason"];
      if (
        (code !== undefined && typeof code !== "number") ||
        (reason !== undefined && typeof reason !== "string")
      ) {
        return undefined;
      }
      return { v: 1, id, kind, code, reason };
    }
    case "ws.closed": {
      const code = raw["code"];
      const reason = raw["reason"];
      const wasClean = raw["wasClean"];
      if (
        typeof code !== "number" ||
        typeof reason !== "string" ||
        typeof wasClean !== "boolean"
      ) {
        return undefined;
      }
      return { v: 1, id, kind, code, reason, wasClean };
    }
    default:
      return undefined;
  }
}

export function resolveWireMode(
  optionMode: PortWireMode | undefined,
  endpointMode: PortWireMode | undefined,
): PortWireMode {
  return optionMode ?? endpointMode ?? "structured";
}

export function reconstructError(message: string, name?: string): Error {
  const err = new Error(message);
  if (name !== undefined && name !== "") {
    err.name = name;
  }
  return err;
}

export function toHeaders(pairs: readonly HeaderPair[]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) {
    headers.append(name, value);
  }
  return headers;
}
