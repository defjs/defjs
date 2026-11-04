/**
 * Reads a method as a value, so assertions and spies can inspect a mock without detaching it.
 */
export function method<T, K extends keyof T>(target: T, key: K): T[K] {
  return target[key];
}
