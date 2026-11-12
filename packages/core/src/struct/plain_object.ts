/**
 * A null-prototype object for a node whose keys come from a struct.
 *
 * V8 puts `Object.create(null)` objects in dictionary mode, which makes every later write and read
 * slower, including the caller's reads of a decoded body. Dropping the prototype from a fresh literal
 * keeps fast properties. With no prototype, a `__proto__` key is an ordinary own data property.
 * Records keep `Object.create(null)`: arbitrary keys are what dictionary mode is for.
 */
export function nullObject(): { [key: string]: unknown } {
  const value: { [key: string]: unknown } = {};
  Object.setPrototypeOf(value, null);
  return value;
}

export function isPlainObject(
  value: unknown,
): value is { [key: string]: unknown } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
