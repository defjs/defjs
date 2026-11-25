import { expectTypeOf } from "vitest";
import type { HttpRequest, HttpResponseType } from "./http_request";

declare const request: HttpRequest;

expectTypeOf<HttpRequest["responseType"]>().toEqualTypeOf<
  HttpResponseType | undefined
>();
expectTypeOf<HttpRequest["errorResponseType"]>().toEqualTypeOf<
  HttpResponseType | undefined
>();
expectTypeOf<HttpRequest["correlationId"]>().toEqualTypeOf<
  string | undefined
>();
expectTypeOf<HttpRequest["retryAttempt"]>().toEqualTypeOf<number | undefined>();

// @ts-expect-error responseType is derived from the endpoint output struct and must not be changed
request.responseType = "json";

// @ts-expect-error errorResponseType is derived from the endpoint error struct and must not be changed
request.errorResponseType = "text";

// @ts-expect-error correlationId is per-call execution metadata and must not be changed
request.correlationId = "other";

// @ts-expect-error retryAttempt is per-attempt execution metadata and must not be changed
request.retryAttempt = 2;
