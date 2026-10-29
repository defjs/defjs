export type RequestScalarValue = bigint | boolean | null | number | string;

export type RequestBuildValue =
  | readonly unknown[]
  | { [key: string]: unknown }
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

export function isRequestScalarValue(
  value: unknown,
): value is RequestScalarValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  );
}

export function serializeRequestScalarValue(value: RequestScalarValue): string {
  return String(value);
}
