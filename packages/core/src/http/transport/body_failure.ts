import { describeCause } from '../../error/cause'
import type { HttpMeta } from '../../internal/http_response'

/** Which fault a body-stage failure becomes once it reaches command execution. */
export type BodyFailureCode = 'EXT_OBSERVER_FAILED' | 'NET_BODY_INCOMPLETE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'

type BodyFailureMeta<C extends BodyFailureCode> = C extends 'EXT_OBSERVER_FAILED' ? HttpMeta | undefined : HttpMeta

/**
 * A failure raised while reading a body or running a progress observer, tagged at the point
 * where the transport still knows which step failed.
 *
 * An upload observer can fail before any response exists, so `meta` is absent then. Download
 * observers, truncated reads, and representation checks already have a response. Those steps
 * are indistinguishable once they collapse into a bare cause, so command execution maps
 * `code` straight through.
 *
 * Caller cancellation is deliberately never tagged: it stays the raw abort reason so the
 * cancellation path keeps priority over body classification.
 */
export class BodyFailure<C extends BodyFailureCode = BodyFailureCode> extends Error {
  readonly code: C
  readonly meta: BodyFailureMeta<C>

  constructor(code: C, cause: unknown, meta: BodyFailureMeta<C>) {
    super(describeCause(cause), { cause })
    this.code = code
    this.meta = meta
    Object.defineProperty(this, 'name', { configurable: true, enumerable: false, value: 'BodyFailure', writable: true })
  }
}

/** Every tagged failure, discriminated by `code`. */
export type AnyBodyFailure = { [C in BodyFailureCode]: BodyFailure<C> }[BodyFailureCode]

/**
 * Whether `value` is a tagged body-stage failure.
 *
 * @param value - Any thrown or carried value.
 * @returns True when the transport classified it.
 */
export function isBodyFailure(value: unknown): value is AnyBodyFailure {
  return value instanceof BodyFailure
}
