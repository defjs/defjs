// #region example
import type { ClientOption } from "@defjs/core";
import { createHttpInterceptor, withInterceptors } from "@defjs/core";

export function withRequestIdHeader(headerName = "x-request-id"): ClientOption {
  const interceptor = createHttpInterceptor(async (request, next) => {
    const headers = new Headers(request.headers);
    if (!headers.has(headerName)) {
      headers.set(headerName, crypto.randomUUID());
    }
    return next({ ...request, headers });
  });

  return withInterceptors(interceptor);
}
// #endregion
