import type { QuerySerializer } from "../client/config";
import type { HttpRequest } from "../http/http_request";
import {
  createResolvedRequestUrl,
  fillUrl,
  resolveRequestUrl,
  resolveTransportQuery,
} from "../internal/url";

export function createWebSocketRequest(params: {
  signal: AbortSignal;
  baseEndpoint: string;
  operation?: string;
  params?: { [key: string]: string };
  path: string;
  query?: URLSearchParams | { [key: string]: unknown };
  querySerializer?: QuerySerializer;
  withCredentials?: boolean;
}): HttpRequest {
  const query = resolveTransportQuery(params.query, params.querySerializer);
  const request: HttpRequest = {
    signal: params.signal,
    baseEndpoint: params.baseEndpoint,
    endpoint: fillUrl(params.path, params.params),
    headers: new Headers(),
    method: "GET",
    operation: params.operation,
    query,
    withCredentials: params.withCredentials ?? false,
  };
  // The query cannot make a URL invalid, so only the endpoint is checked here; every attempt resolves the whole URL.
  createResolvedRequestUrl(params.baseEndpoint, request.endpoint);
  return request;
}

export function createWebSocketUrlFromRequest(request: HttpRequest): string {
  const url = resolveRequestUrl(request);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  return url.toString();
}
