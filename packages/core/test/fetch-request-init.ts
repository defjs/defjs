import type { HttpRequest } from "../src/http/index.ts";
import { createFetchRequestInit } from "../src/http/transport/fetch.ts";
import { resolveRequestUrl } from "../src/internal/url.ts";

/** The `RequestInit` the transport builds for `request`, with the URL the request resolves to. */
export function initOf(
  request: HttpRequest,
  onBodyFailed?: () => void,
): ReturnType<typeof createFetchRequestInit> {
  return createFetchRequestInit(
    request,
    resolveRequestUrl(request),
    onBodyFailed,
  );
}
