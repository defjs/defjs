import { awaitWithSignal } from "./abort";

/**
 * Fetch's "null body status" set. A response with one of these statuses has no body in every
 * runtime; Chromium and Firefox still expose an empty stream for some of them.
 */
export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

export type LateResponseBodyHandler = (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) => void;

export async function fetchWithSignal(
  send: () => Promise<Response>,
  signal: AbortSignal | undefined,
  onLateResponseBody: LateResponseBodyHandler,
): Promise<Response> {
  if (!signal) {
    return send();
  }

  return awaitWithSignal(() => {
    const pending = send();
    void pending
      .then((response) => {
        if (signal.aborted && response.body) {
          onLateResponseBody(response.body, signal);
        }
      })
      .catch(() => undefined);
    return pending;
  }, signal);
}
