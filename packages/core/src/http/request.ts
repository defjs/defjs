import type { QuerySerializer } from "../client/config";
import type {
  HttpProgressFn,
  HttpRequest,
  HttpResponseType,
} from "../internal/http_request";
import type { OutboundBuilder } from "../internal/outbound_request";
import { createBaseTransportRequest } from "../internal/transport_request";
import type { Guide } from "../struct/guide";

export function createHttpRequest(
  method: string,
  path: string,
  input: unknown,
  builder: OutboundBuilder | undefined,
  options: {
    signal: AbortSignal;
    baseEndpoint: string;
    defaultHeaders?: Headers;
    downloadProgress?: HttpProgressFn;
    inputDeclared?: boolean;
    inputGuides?: WeakMap<object, Guide>;
    operation?: string;
    errorResponseType?: HttpResponseType;
    querySerializer?: QuerySerializer;
    responseType?: HttpResponseType;
    uploadProgress?: HttpProgressFn;
    withCredentials?: boolean;
    xsrf?: {
      cookieName: string;
      headerName: string;
      tokenProvider?: (context: {
        request: HttpRequest;
      }) => string | null | undefined;
    };
  },
): HttpRequest {
  const request = createBaseTransportRequest(method, path, input, builder, {
    signal: options.signal,
    baseEndpoint: options.baseEndpoint,
    defaultHeaders: options.defaultHeaders,
    inputDeclared: options.inputDeclared,
    inputGuides: options.inputGuides,
    operation: options.operation,
    querySerializer: options.querySerializer,
    transport: "http",
    withCredentials: options.withCredentials,
  });

  return {
    ...request,
    downloadProgress: options.downloadProgress,
    errorResponseType: options.errorResponseType,
    responseType: options.responseType,
    uploadProgress: options.uploadProgress,
    xsrf: snapshotXsrf(options.xsrf),
  };
}

function snapshotXsrf(value: HttpRequest["xsrf"]): HttpRequest["xsrf"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return {
    cookieName: value.cookieName,
    headerName: value.headerName,
    tokenProvider: value.tokenProvider,
  };
}
