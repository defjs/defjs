import { DEFINITION } from "../src/struct/symbols";
import type { RuntimeStruct } from "../src/struct/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function nullPrototypeRecord(): Record<string, unknown> {
  const value: unknown = Object.create(null);
  if (!isRecord(value)) {
    throw new Error("Object.create(null) did not return an object");
  }
  return value;
}

export function readOwn(target: object, key: PropertyKey): unknown {
  if (!Object.hasOwn(target, key)) return undefined;
  const value: unknown = Reflect.get(target, key);
  return value;
}

export function symbolValue(value: unknown, key: symbol): unknown {
  if (!isObject(value) || !(key in value)) return undefined;
  const result: unknown = Reflect.get(value, key);
  return result;
}

export function assertObject(value: unknown, label: string): object {
  if (!isObject(value))
    throw new TypeError(`Expected ${label} to be an object`);
  return value;
}

export function assertRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value))
    throw new TypeError(`Expected ${label} to be an object`);
  return value;
}

export function isRuntimeStruct(value: unknown): value is RuntimeStruct {
  return isObject(value) && Object.hasOwn(value, DEFINITION);
}

export function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error["code"];
  return typeof code === "string" ? code : undefined;
}

/** Same strings as `String(data)` for the socket data union, without stringifying an object. */
export function socketText(data: string | Blob | ArrayBufferLike): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return "[object ArrayBuffer]";
  if (
    typeof SharedArrayBuffer === "function" &&
    data instanceof SharedArrayBuffer
  ) {
    return "[object SharedArrayBuffer]";
  }
  return "[object Blob]";
}
