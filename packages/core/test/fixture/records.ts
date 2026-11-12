import type { FixtureHeaders } from "./types.ts";

export function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value of an own property, so that an inherited or `__proto__` key never reads as data. */
export function own(record: { [key: string]: unknown }, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  const value: unknown = Reflect.get(record, key);
  return value;
}

export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isStringRecord(value: unknown): value is FixtureHeaders {
  if (!isRecord(value)) return false;
  for (const entry of Object.entries(value)) {
    if (typeof entry[1] !== "string") return false;
  }
  return true;
}
