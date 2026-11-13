import type { QuerySerializer } from "../client/config";
import type { HttpRequest } from "./http_request";
import type { MaterializedRequest } from "../internal/outbound_request";
import { isFormData } from "../internal/type_guards";
import {
  createResolvedRequestUrl,
  fillUrl,
  mergeHeaders,
  resolveTransportQuery,
} from "../internal/url";

type BaseTransportRequest = HttpRequest & {
  signal: AbortSignal;
  baseEndpoint: string;
  headers: Headers;
  query: URLSearchParams;
};

export type BaseTransportRequestOptions = {
  signal: AbortSignal;
  baseEndpoint: string;
  defaultHeaders?: Headers;
  operation?: string;
  querySerializer?: QuerySerializer;
  withCredentials?: boolean;
};

/**
 * The request that HTTP and SSE share: the materialized `built` request placed on `path` under the endpoint, with the
 * default headers and the builder's headers merged. The caller materializes the builder's result for its transport
 * and decides what a body without a declared `Content-Type` is sent as.
 *
 * A body on GET or HEAD is a build error here: Bun's Request accepts it and only fetch() throws. A `FormData` body
 * never keeps a `Content-Type`: the platform adds the multipart boundary.
 */
export function createBaseTransportRequest(
  method: string,
  path: string,
  built: MaterializedRequest,
  options: BaseTransportRequestOptions,
): BaseTransportRequest {
  const upperMethod = method.toUpperCase();
  if (
    built.body !== undefined &&
    (upperMethod === "GET" || upperMethod === "HEAD")
  ) {
    throw new TypeError("GET/HEAD requests cannot have a body");
  }
  const query = resolveTransportQuery(built.query, options.querySerializer);
  const headers = options.defaultHeaders
    ? new Headers(options.defaultHeaders)
    : new Headers();

  if (built.headers) {
    mergeHeaders(headers, built.headers);
  }
  if (isFormData(built.body)) {
    headers.delete("Content-Type");
  }

  const request: BaseTransportRequest = {
    signal: options.signal,
    baseEndpoint: options.baseEndpoint,
    body: built.body,
    bodyContentTypeSource: built.body,
    endpoint: fillUrl(path, built.params),
    headers,
    method,
    operation: options.operation,
    query,
    withCredentials: options.withCredentials ?? false,
  };

  // The query cannot make a URL invalid, so only the endpoint is checked here; every send resolves the whole URL.
  createResolvedRequestUrl(request.baseEndpoint, request.endpoint);
  return request;
}
