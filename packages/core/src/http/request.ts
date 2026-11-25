import type { QuerySerializer } from "../client/config";
import type {
  HttpProgressFn,
  HttpRequest,
  HttpResponseType,
} from "./http_request";
import type { OutboundBuilder } from "../internal/outbound_request";
import {
  materializeOutboundRequest,
  runOutboundBuilder,
} from "../internal/outbound_request";
import {
  createResolvedRequestUrl,
  fillCompiledPath,
  mergeHeaders,
  resolveDirectQueryString,
  type CompiledPathTemplate,
} from "../internal/url";
import { isFormData } from "../internal/type_guards";
import {
  assertMethodAllowsBody,
  prepareBaseTransportRequest,
} from "./transport_request";
import type { Guide } from "../struct/guide";
import { resolveHttpBodyContentType } from "./transport/body";

export interface PreparedHttpRequest {
  readonly request: HttpRequest;
  readonly url: URL;
}

export function prepareHttpRequest(
  method: string,
  path: string,
  input: unknown,
  builder: OutboundBuilder | undefined,
  options: {
    signal: AbortSignal;
    baseEndpoint: string;
    defaultHeaders?: Headers;
    downloadProgress?: HttpProgressFn;
    inputGuides?: WeakMap<object, Guide>;
    meta?: { [key: string]: unknown };
    pathTemplate?: CompiledPathTemplate;
    errorResponseType?: HttpResponseType;
    querySerializer?: QuerySerializer;
    responseType?: HttpResponseType;
    correlationId?: string;
    retryAttempt?: number;
    uploadProgress?: HttpProgressFn;
    withCredentials?: boolean;
    finalizeHeaders?: HttpRequest["finalizeHeaders"];
  },
): PreparedHttpRequest {
  const built = materializeOutboundRequest(
    runOutboundBuilder(input, builder),
    "http",
    options.inputGuides,
  );
  const prepared = prepareBaseTransportRequest(method, path, built, {
    signal: options.signal,
    baseEndpoint: options.baseEndpoint,
    defaultHeaders: options.defaultHeaders,
    meta: options.meta,
    pathTemplate: options.pathTemplate,
    querySerializer: options.querySerializer,
    withCredentials: options.withCredentials,
  });

  return {
    url: prepared.url,
    request: {
      ...prepared.request,
      // HTTP never stores an inferred type in the headers; the transport applies it when it sends.
      bodyContentType:
        built.defaultContentType ??
        resolveHttpBodyContentType(prepared.request.body),

      downloadProgress: options.downloadProgress,
      errorResponseType: options.errorResponseType,
      responseType: options.responseType,
      correlationId: options.correlationId,
      retryAttempt: options.retryAttempt,
      uploadProgress: options.uploadProgress,
      finalizeHeaders: options.finalizeHeaders,
    },
  };
}

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
    inputGuides?: WeakMap<object, Guide>;
    meta?: { [key: string]: unknown };
    pathTemplate?: CompiledPathTemplate;
    errorResponseType?: HttpResponseType;
    querySerializer?: QuerySerializer;
    responseType?: HttpResponseType;
    correlationId?: string;
    retryAttempt?: number;
    uploadProgress?: HttpProgressFn;
    withCredentials?: boolean;
    finalizeHeaders?: HttpRequest["finalizeHeaders"];
  },
): HttpRequest {
  return prepareHttpRequest(method, path, input, builder, options).request;
}

export interface DirectHttpRequestOptions {
  readonly baseEndpoint: string;
  readonly defaultHeaders?: Headers;
  readonly downloadProgress?: HttpProgressFn;
  readonly inputGuides?: WeakMap<object, Guide>;
  readonly meta?: { [key: string]: unknown };
  readonly errorResponseType?: HttpResponseType;
  readonly querySerializer?: QuerySerializer;
  readonly responseType?: HttpResponseType;
  readonly retryAttempt?: number;
  readonly uploadProgress?: HttpProgressFn;
  readonly withCredentials?: boolean;
}

/** Builds a lean HTTP request directly for transport when no signal, timeout, interceptor, or finalizeHeaders is active. */
export function buildDirectHttpRequest(
  method: string,
  path: string,
  pathTemplate: CompiledPathTemplate | undefined,
  input: unknown,
  builder: OutboundBuilder | undefined,
  options: DirectHttpRequestOptions,
): PreparedHttpRequest {
  const built = materializeOutboundRequest(
    runOutboundBuilder(input, builder),
    "http",
    options.inputGuides,
  );
  assertMethodAllowsBody(method, built.body);
  const search = resolveDirectQueryString(built.query, options.querySerializer);
  const endpoint = fillCompiledPath(path, pathTemplate, built.params);
  const url = createResolvedRequestUrl(options.baseEndpoint, endpoint, search);
  let headers: Headers | undefined;
  if (options.defaultHeaders !== undefined || built.headers !== undefined) {
    headers = options.defaultHeaders
      ? new Headers(options.defaultHeaders)
      : new Headers();
    if (built.headers !== undefined) {
      mergeHeaders(headers, built.headers);
    }
    if (isFormData(built.body)) {
      headers.delete("Content-Type");
    }
  }

  return {
    url,
    request: {
      baseEndpoint: options.baseEndpoint,
      body: built.body,
      bodyContentType:
        built.defaultContentType ?? resolveHttpBodyContentType(built.body),
      bodyContentTypeSource: built.body,
      downloadProgress: options.downloadProgress,
      endpoint,
      errorResponseType: options.errorResponseType,
      headers,
      method,
      meta: options.meta,
      responseType: options.responseType,
      retryAttempt: options.retryAttempt,
      uploadProgress: options.uploadProgress,
      withCredentials: options.withCredentials ?? false,
    },
  };
}
