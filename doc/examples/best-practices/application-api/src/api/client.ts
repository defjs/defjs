// #region example
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withHeaders,
  withHTTPHandle,
  withInterceptors,
  withRetry,
  type FetchHandle,
} from "@defjs/core";

const handle: FetchHandle = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.pathname === "/orders/999") {
    return Promise.resolve(
      Response.json(
        {
          code: "ORDER_NOT_FOUND",
          message: "Order #999 does not exist.",
          request_id: "req-404",
        },
        { status: 404 },
      ),
    );
  }
  if (request.method === "POST" && url.pathname === "/orders") {
    return Promise.resolve(
      Response.json(
        {
          id: 101,
          customer_name: "Grace Hopper",
          total_cents: 6400,
          status: "paid",
        },
        { status: 201 },
      ),
    );
  }
  if (request.method === "GET" && url.pathname === "/orders") {
    return Promise.resolve(
      Response.json({
        items: [
          {
            id: 101,
            customer_name: "Ada Lovelace",
            total_cents: 4200,
            status: "paid",
          },
        ],
      }),
    );
  }
  return Promise.resolve(
    Response.json({
      id: 101,
      customer_name: "Ada Lovelace",
      total_cents: 4200,
      status: "paid",
    }),
  );
};

const authInterceptor = createHttpInterceptor((request, next) => {
  const headers = new Headers(request.headers);
  if (!headers.has("authorization")) {
    headers.set("authorization", "Bearer browser-session-token");
  }
  return next({ ...request, headers });
});

// Browser / single-tenant app: share one module-scoped client
export const apiClient = createClient(
  withEndpoint("https://api.store.example"),
  withInterceptors(authInterceptor),
  withRetry({ maxRetries: 2 }),
  withHTTPHandle(handle),
);

// SSR / multi-tenant server: create a fresh client per incoming request
export function createServerApiClient(accessToken: string) {
  return createClient(
    withEndpoint("https://api.store.example"),
    withHeaders({ authorization: `Bearer ${accessToken}` }),
    withRetry({ maxRetries: 2 }),
    withHTTPHandle(handle),
  );
}
// #endregion
