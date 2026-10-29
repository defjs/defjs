export const DEFINITION: unique symbol = Symbol.for("defjs.struct.definition");
export const OMIT: unique symbol = Symbol("defjs.struct.omit");

/**
 * Stands in for a parsed value when parsing fails; the issue waits in the slot that `failure()` fills.
 * Not in the symbol registry, so no input value can ever equal it.
 */
export const FAILED: unique symbol = Symbol("defjs.struct.failed");

/**
 * Type-only export of the internal enumerable tag key on objects produced while parsing endpoint input, used by the outbound encoder.
 *
 * `STRUCT` is exported as a **type** only (`export type { STRUCT }`). `@defjs/core` has no runtime `STRUCT` export, so `import { STRUCT } from '@defjs/core'` fails to compile and gives no value.
 *
 * It marks those objects so the outbound encoder knows which struct produced them. Response decoding and `struct.parse` leave it unset. The symbol is internal to the outbound encoder; application code should not depend on it.
 *
 * @internal
 * @group struct
 */
export const STRUCT: unique symbol = Symbol.for("defjs.struct.STRUCT");
