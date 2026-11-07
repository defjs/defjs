// #region example
import { createHttpInterceptor } from "@defjs/core";

export type Credential = { accessToken: string };

export function refreshingBearer(
  read: () => Credential,
  refresh: (stale: Credential) => Promise<Credential>,
) {
  let flight: Promise<Credential> | undefined;

  return createHttpInterceptor(async (request, next) => {
    const authorize = (credential: Credential) => {
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${credential.accessToken}`);
      return { ...request, headers };
    };

    const used = read();
    const response = await next(authorize(used));
    const body = response.body;
    if (
      (typeof ReadableStream !== "undefined" &&
        request.body instanceof ReadableStream) ||
      response.status !== 401 ||
      typeof body !== "object" ||
      body === null ||
      !("code" in body) ||
      body.code !== "expired_token"
    ) {
      return response;
    }

    const current = read();
    if (current.accessToken !== used.accessToken) {
      return next(authorize(current));
    }

    flight ??= refresh(used).finally(() => {
      flight = undefined;
    });
    const refreshed = await flight;
    return next(authorize(refreshed));
  });
}
// #endregion
