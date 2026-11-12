import type { QuerySerializer } from "../client/config";
import type {
  HttpProgressFn,
  HttpRequest,
  HttpResponseType,
} from "../internal/http_request";
import type { OutboundBuilder } from "../internal/outbound_request";
import {
  materializeOutboundRequest,
  runOutboundBuilder,
} from "../internal/outbound_request";
import { createBaseTransportRequest } from "../internal/transport_request";
import type { Guide } from "../struct/guide";
import { resolveHttpBodyContentType } from "./transport/body";

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
    finalizeHeaders?: HttpRequest["finalizeHeaders"];
  },
): HttpRequest {
  const built = materializeOutboundRequest(
    runOutboundBuilder(input, builder, options.inputDeclared),
    "http",
    options.inputGuides,
  );
  const request = createBaseTransportRequest(method, path, built, {
    signal: options.signal,
    baseEndpoint: options.baseEndpoint,
    defaultHeaders: options.defaultHeaders,
    operation: options.operation,
    querySerializer: options.querySerializer,
    withCredentials: options.withCredentials,
  });

  return {
    ...request,
    // HTTP never stores an inferred type in the headers; the transport applies it when it sends.
    bodyContentType:
      built.defaultContentType ?? resolveHttpBodyContentType(request.body),

    downloadProgress: options.downloadProgress,
    errorResponseType: options.errorResponseType,
    responseType: options.responseType,
    uploadProgress: options.uploadProgress,
    finalizeHeaders: options.finalizeHeaders,
  };
}
