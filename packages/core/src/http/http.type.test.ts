import { expectTypeOf } from "vitest";
import { createClient } from "../client";
import type { DecodedResponse, HttpMeta } from "../internal/http_response";
// @ts-expect-error RequestCommandBuilder was renamed to RequestEndpoint
import type { RequestCommandBuilder } from "./http";

import type { HttpAwaitResult, RequestEndpoint } from "./http";
import { defineRequest } from "./http";
import { struct } from "../struct";

const User = struct.object({ id: struct.number(), name: struct.string() });
const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
});

const useGetUser = defineRequest({
  builder: (input) => ({ path: input }),
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  output: User,
});

function takesRequestEndpoint<
  Args extends unknown[],
  Data,
  ErrorData,
  Response extends HttpMeta,
>(
  endpoint: RequestEndpoint<Args, Data, ErrorData, Response>,
): RequestEndpoint<Args, Data, ErrorData, Response> {
  return endpoint;
}

expectTypeOf(takesRequestEndpoint(useGetUser)).toEqualTypeOf<
  typeof useGetUser
>();
void (undefined as unknown as RequestCommandBuilder);

useGetUser(createClient(), { id: 1 });

// Optional input builder should allow no argument
const useList = defineRequest({
  method: "GET",
  path: "/users",
  output: struct.object({ items: struct.object({}) }),
});
expectTypeOf(useList).toBeCallableWith(createClient());

// ---------------------------------------------------------------------------
// Philosophy 1: `output` types the 2xx body, `error` types the non-2xx body.
// ---------------------------------------------------------------------------
const useBoth = defineRequest({
  method: "GET",
  path: "/both",
  error: ApiError,
  output: User,
});

async function assertBothDeclared(): Promise<void> {
  const [fault, data, response] = await useBoth(createClient());

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<{ id: number; name: string }>();
    expectTypeOf(response).toEqualTypeOf<
      DecodedResponse<{ id: number; name: string }>
    >();
    expectTypeOf(response.body).toEqualTypeOf<{ id: number; name: string }>();
    return;
  }

  expectTypeOf(data).toEqualTypeOf<undefined>();
  expectTypeOf(response).toEqualTypeOf<undefined>();

  if (fault.code === "HTTP_STATUS") {
    expectTypeOf(fault.data).toEqualTypeOf<{ code: string; message: string }>();
    expectTypeOf(fault.response.body).toEqualTypeOf<{
      code: string;
      message: string;
    }>();
    expectTypeOf(fault.status).toEqualTypeOf<number>();
    return;
  }

  if (fault.code === "RES_STRUCT_MISMATCH") {
    expectTypeOf(fault.response).toEqualTypeOf<HttpMeta>();
    // @ts-expect-error Philosophy 4: a failed decode produced no body.
    void fault.response.body;
    // @ts-expect-error A failed decode produced no value, so there is no `data`.
    void fault.data;
  }
}

void assertBothDeclared;

// ---------------------------------------------------------------------------
// Philosophy 5: omitting a declaration skips that decode entirely.
// ---------------------------------------------------------------------------
const useOutputOnly = defineRequest({
  method: "GET",
  path: "/output-only",
  output: User,
});

async function assertOutputOnly(): Promise<void> {
  const [fault, data] = await useOutputOnly(createClient());

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<{ id: number; name: string }>();
    return;
  }

  if (fault.code === "HTTP_STATUS") {
    expectTypeOf(fault.data).toEqualTypeOf<undefined>();
    expectTypeOf(fault.response).toEqualTypeOf<HttpMeta>();
    // @ts-expect-error Philosophy 5: no `error` struct was declared, so no body was read.
    void fault.response.body;
  }
}

void assertOutputOnly;

const useErrorOnly = defineRequest({
  method: "POST",
  path: "/error-only",
  error: ApiError,
});

async function assertErrorOnly(): Promise<void> {
  const [fault, data, response] = await useErrorOnly(createClient());

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<undefined>();
    expectTypeOf(response).toEqualTypeOf<HttpMeta>();
    // @ts-expect-error Philosophy 5: no `output` struct was declared, so no body was read.
    void response.body;
    return;
  }

  if (fault.code === "HTTP_STATUS") {
    expectTypeOf(fault.data).toEqualTypeOf<{ code: string; message: string }>();
  }
}

void assertErrorOnly;

const useNeither = defineRequest({ method: "DELETE", path: "/neither" });

async function assertNeitherDeclared(): Promise<void> {
  const [fault, data, response] = await useNeither(createClient());

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<undefined>();
    expectTypeOf(response).toEqualTypeOf<HttpMeta>();
    return;
  }

  if (fault.code === "HTTP_STATUS") {
    expectTypeOf(fault.data).toEqualTypeOf<undefined>();
  }
}

void assertNeitherDeclared;

// ---------------------------------------------------------------------------
// Representation follows the struct kind. `responseType` is not a definition option.
// ---------------------------------------------------------------------------
// @ts-expect-error responseType was removed; the struct kind selects the representation.
defineRequest({ method: "GET", path: "/discarded", responseType: "json" });

defineRequest({
  method: "GET",
  output: struct.string(),
  path: "/text",
  // @ts-expect-error responseType was removed even when an output struct is declared.
  responseType: "text",
});

defineRequest({
  error: ApiError,
  method: "GET",
  path: "/error-response-type",
  // @ts-expect-error responseType was removed even when an error struct is declared.
  responseType: "json",
});

const typeClient = createClient();
const useEmptyObject = defineRequest({
  builder: () => ({}),
  method: "POST",
  path: "/empty",
  input: struct.object({}),
});
// @ts-expect-error a required root Struct still requires an input argument even when {} is a valid value.
useEmptyObject(typeClient);
useEmptyObject(typeClient, {});

const useOptionalFields = defineRequest({
  builder: (input) => ({ query: { q: input.keyword } }),
  method: "GET",
  path: "/search",
  input: struct.object({ keyword: struct.string().optional() }),
});
// @ts-expect-error optional fields do not make the root object optional.
useOptionalFields(typeClient);
useOptionalFields(typeClient, {});

const useOptionalRoot = defineRequest({
  builder: () => ({}),
  method: "POST",
  path: "/optional",
  input: struct.object({}).optional(),
});
useOptionalRoot(typeClient);

const useUnionInput = defineRequest({
  builder: (input) => ({ body: input }),
  method: "POST",
  path: "/union",
  input: struct.or(struct.string(), struct.number()),
});
// @ts-expect-error a required union input cannot be omitted.
useUnionInput(typeClient);
useUnionInput(typeClient, "value");

const useOptionalObjects = defineRequest({
  builder: (input) => ({ headers: input.trace, query: input.paging }),
  input: struct.object({
    locale: struct.object({ region: struct.string().optional() }).optional(),
    paging: struct.object({ page: struct.number().optional() }).optional(),
    trace: struct.object({ traceId: struct.string().optional() }).optional(),
  }),
  method: "GET",
  path: "/optional-objects",
});
useOptionalObjects(typeClient, {});
useOptionalObjects(typeClient, { paging: { page: 1 } });
// @ts-expect-error the input root remains required even when every declared field is optional.
useOptionalObjects(typeClient);

const useMixedObject = defineRequest({
  builder: (input) => ({ query: input.search }),
  input: struct.object({
    search: struct.object({
      page: struct.number().optional(),
      q: struct.string(),
    }),
  }),
  method: "GET",
  path: "/mixed-object",
});
useMixedObject(typeClient, { search: { q: "defjs" } });
// @ts-expect-error an object field with any required field cannot be omitted.
useMixedObject(typeClient, {});

const useOptionalInnerFields = defineRequest({
  builder: (input) => ({ body: input.note }),
  input: struct.object({
    note: struct.object({ text: struct.string().optional() }),
  }),
  method: "POST",
  path: "/body",
});
useOptionalInnerFields(typeClient, { note: {} });
// @ts-expect-error all-optional inner fields do not make a required object field optional.
useOptionalInnerFields(typeClient, {});

declare const result: HttpAwaitResult<{ name: string }, { code: string }>;
const [error, data, response] = result;

if (error) {
  expectTypeOf(data).toEqualTypeOf<undefined>();
  expectTypeOf(response).toEqualTypeOf<undefined>();
} else {
  expectTypeOf(data).toEqualTypeOf<{ name: string }>();
  expectTypeOf(response).toEqualTypeOf<DecodedResponse<{ name: string }>>();
  expectTypeOf(response.ok).toEqualTypeOf<boolean>();
}

export type Cases = true;
