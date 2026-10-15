import { expectTypeOf } from 'vitest'
import { type STRUCT } from '../index'

type Tagged = { readonly [STRUCT]: string }

// The symbol stays visible to declaration emit so BuilderInput can name it.
expectTypeOf<Tagged[typeof STRUCT]>().toEqualTypeOf<string>()

// @ts-expect-error STRUCT is type-only on the public entry and has no runtime value.
import { STRUCT as StructRuntime } from '../index'

// @ts-expect-error STRUCT is type-only on the public entry and has no runtime value.
void StructRuntime
