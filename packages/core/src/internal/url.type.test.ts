import { expectTypeOf } from 'vitest'
import type { createWebSocketRequest } from '../web_socket/build'
import type { fillUrl } from './url'

// materializePath already turns every public path value into a string, so both callers pass only strings.
type PathParams = { [key: string]: string } | undefined

expectTypeOf<Parameters<typeof fillUrl>[1]>().toEqualTypeOf<PathParams>()
expectTypeOf<Parameters<typeof createWebSocketRequest>[0]['params']>().toEqualTypeOf<PathParams>()
