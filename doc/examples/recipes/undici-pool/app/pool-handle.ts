// #region example
import type { FetchHandle } from "@defjs/core";
import type { Dispatcher, Pool } from "undici";

function toHttpMethod(method: string): Dispatcher.HttpMethod {
  switch (method.toUpperCase()) {
    case "GET":
      return "GET";
    case "HEAD":
      return "HEAD";
    case "POST":
      return "POST";
    case "PUT":
      return "PUT";
    case "DELETE":
      return "DELETE";
    case "CONNECT":
      return "CONNECT";
    case "OPTIONS":
      return "OPTIONS";
    case "TRACE":
      return "TRACE";
    case "PATCH":
      return "PATCH";
    default:
      throw new TypeError(`Unsupported HTTP method: ${method}`);
  }
}

export function createUndiciPoolHandle(
  pool: Pick<Pool, "request">,
): FetchHandle {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const target = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const method = toHttpMethod(request.method);
    const body =
      method === "GET" || method === "HEAD" || request.body === null
        ? undefined
        : new Uint8Array(await request.arrayBuffer());

    const res = await pool.request({
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      body,
      signal: request.signal,
    });

    const responseHeaders: [string, string][] = [];
    for (const [key, value] of Object.entries(res.headers)) {
      if (typeof value === "string") {
        responseHeaders.push([key, value]);
      } else if (Array.isArray(value)) {
        responseHeaders.push([key, value.join(", ")]);
      }
    }

    const payload = await res.body.arrayBuffer();
    const isNullBody =
      res.statusCode === 204 ||
      res.statusCode === 205 ||
      res.statusCode === 304;

    return new Response(isNullBody ? null : payload, {
      status: res.statusCode,
      headers: responseHeaders,
    });
  };
}
// #endregion
