export const DEFINITION: unique symbol = Symbol.for('defjs.struct.definition')
export const OMIT: unique symbol = Symbol.for('defjs.struct.omit')

/**
 * Stands in for a parsed value when parsing fails; the issue waits in the slot that `failure()` fills.
 * Not in the symbol registry, so no input value can ever equal it.
 */
export const FAILED: unique symbol = Symbol('defjs.struct.failed')

/**
 * Enumerable tag on objects produced while parsing endpoint input.
 * Response decoding and `struct.parse` leave it unset. Internal to the outbound encoder.
 *
 * @internal
 */
export const STRUCT: unique symbol = Symbol.for('defjs.struct.STRUCT')
