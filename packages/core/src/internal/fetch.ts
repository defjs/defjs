import { awaitWithSignal } from './abort'

export type LateResponseBodyHandler = (body: ReadableStream<Uint8Array>, signal: AbortSignal) => void

export async function fetchWithSignal(
  send: () => Promise<Response>,
  signal: AbortSignal | undefined,
  onLateResponseBody: LateResponseBodyHandler,
): Promise<Response> {
  if (!signal) {
    return send()
  }

  return awaitWithSignal(() => {
    const pending = send()
    void pending
      .then((response) => {
        if (signal.aborted && response.body) {
          onLateResponseBody(response.body, signal)
        }
      })
      .catch(() => undefined)
    return pending
  }, signal)
}
