/**
 * Values an interceptor can resolve that are not its transport's result, as factories because a `Response` body reads once.
 * Types forbid all of them, so only JavaScript callers, `any`, and untyped mocks reach the runtime check.
 */
export const MALFORMED_INTERCEPTOR_RESULTS = [
  ['undefined', () => undefined],
  ['null', () => null],
  ['a native Response', () => new Response()],
  ['a string', () => 'result'],
  ['an empty object', () => ({})],
  ['a closed-only lookalike', () => ({ closed: Promise.resolve({ kind: 'closed' }) })],
] as const
