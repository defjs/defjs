import type { AnyStructLike } from '../types'
import { decodeObjectByAlias, encodeObjectByAlias } from './common'

export function encodeJson(struct: AnyStructLike, value: unknown): unknown {
  return encodeObjectByAlias(struct, value, 'json')
}

export function decodeJson(struct: AnyStructLike, value: unknown): unknown {
  return decodeObjectByAlias(struct, value)
}
