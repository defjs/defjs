import { expectTypeOf } from 'vitest'
import type { HTTP_COMMAND } from '../client/command'
import { COMMAND_TYPE } from '../client/command'
import { createClient } from '../client'
import type { DecodedResponse, HttpMeta } from '../internal/http_response'
// @ts-expect-error RequestCommandBuilder was renamed to RequestEndpoint
import type { RequestCommandBuilder } from './http'

import type { HttpAwaitResult, HttpExecuteOptions, RequestEndpoint } from './http'
import { defineRequest } from './http'
import { struct, type AnyStruct } from '../struct'

const User = struct.object({ id: struct.number(), name: struct.string() })
const ApiError = struct.object({ code: struct.string(), message: struct.string() })

const useGetUser = defineRequest({
  builder: (input) => ({ path: input }),
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  output: User,
})

function takesRequestEndpoint<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(endpoint: RequestEndpoint<TInput, TOutput, TError>): RequestEndpoint<TInput, TOutput, TError> {
  return endpoint
}

expectTypeOf(takesRequestEndpoint(useGetUser)).toEqualTypeOf<typeof useGetUser>()
void (undefined as unknown as RequestCommandBuilder)

const command = useGetUser({ id: 1 })
expectTypeOf(command[COMMAND_TYPE]).toEqualTypeOf<typeof HTTP_COMMAND>()

const structuralExecuteOptions: { signal?: AbortSignal; timeout?: number } = {}
const acceptedExecuteOptions: HttpExecuteOptions = structuralExecuteOptions
void acceptedExecuteOptions

async function assertStructuralExecuteOptions(): Promise<void> {
  const [error, result] = await createClient().execute(command, structuralExecuteOptions)
  void error
  void result
}

void assertStructuralExecuteOptions

// @ts-expect-error execute rejects conflicting cancellation options instead of falling through to a catch-all overload.
createClient().execute(command, { abort: new AbortController().signal, timeout: 1 })

// Optional input builder should allow no argument
const useList = defineRequest({ method: 'GET', path: '/users', output: struct.object({ items: struct.object({}) }) })
expectTypeOf(useList).toBeCallableWith()

// ---------------------------------------------------------------------------
// Philosophy 1: `output` types the 2xx body, `error` types the non-2xx body.
// ---------------------------------------------------------------------------
const useBoth = defineRequest({ method: 'GET', path: '/both', error: ApiError, output: User })

async function assertBothDeclared(): Promise<void> {
  const [fault, data, response] = await createClient().execute(useBoth())

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<{ id: number; name: string }>()
    expectTypeOf(response).toEqualTypeOf<DecodedResponse<{ id: number; name: string }>>()
    expectTypeOf(response.body).toEqualTypeOf<{ id: number; name: string }>()
    return
  }

  expectTypeOf(data).toEqualTypeOf<undefined>()
  expectTypeOf(response).toEqualTypeOf<undefined>()

  if (fault.code === 'HTTP_STATUS') {
    expectTypeOf(fault.data).toEqualTypeOf<{ code: string; message: string }>()
    expectTypeOf(fault.response.body).toEqualTypeOf<{ code: string; message: string }>()
    expectTypeOf(fault.status).toEqualTypeOf<number>()
    return
  }

  if (fault.code === 'RES_STRUCT_MISMATCH') {
    expectTypeOf(fault.response).toEqualTypeOf<HttpMeta>()
    // @ts-expect-error Philosophy 4: a failed decode produced no body.
    void fault.response.body
    // @ts-expect-error A failed decode produced no value, so there is no `data`.
    void fault.data
  }
}

void assertBothDeclared

// ---------------------------------------------------------------------------
// Philosophy 5: omitting a declaration skips that decode entirely.
// ---------------------------------------------------------------------------
const useOutputOnly = defineRequest({ method: 'GET', path: '/output-only', output: User })

async function assertOutputOnly(): Promise<void> {
  const [fault, data] = await createClient().execute(useOutputOnly())

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<{ id: number; name: string }>()
    return
  }

  if (fault.code === 'HTTP_STATUS') {
    expectTypeOf(fault.data).toEqualTypeOf<undefined>()
    expectTypeOf(fault.response).toEqualTypeOf<HttpMeta>()
    // @ts-expect-error Philosophy 5: no `error` struct was declared, so no body was read.
    void fault.response.body
  }
}

void assertOutputOnly

const useErrorOnly = defineRequest({ method: 'POST', path: '/error-only', error: ApiError })

async function assertErrorOnly(): Promise<void> {
  const [fault, data, response] = await createClient().execute(useErrorOnly())

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<undefined>()
    expectTypeOf(response).toEqualTypeOf<HttpMeta>()
    // @ts-expect-error Philosophy 5: no `output` struct was declared, so no body was read.
    void response.body
    return
  }

  if (fault.code === 'HTTP_STATUS') {
    expectTypeOf(fault.data).toEqualTypeOf<{ code: string; message: string }>()
  }
}

void assertErrorOnly

const useNeither = defineRequest({ method: 'DELETE', path: '/neither' })

async function assertNeitherDeclared(): Promise<void> {
  const [fault, data, response] = await createClient().execute(useNeither())

  if (!fault) {
    expectTypeOf(data).toEqualTypeOf<undefined>()
    expectTypeOf(response).toEqualTypeOf<HttpMeta>()
    return
  }

  if (fault.code === 'HTTP_STATUS') {
    expectTypeOf(fault.data).toEqualTypeOf<undefined>()
  }
}

void assertNeitherDeclared

// ---------------------------------------------------------------------------
// Representation follows the struct kind. `responseType` is not a definition option.
// ---------------------------------------------------------------------------
// @ts-expect-error responseType was removed; the struct kind selects the representation.
defineRequest({ method: 'GET', path: '/discarded', responseType: 'json' })

// @ts-expect-error responseType was removed even when an output struct is declared.
defineRequest({ method: 'GET', output: struct.string(), path: '/text', responseType: 'text' })

// @ts-expect-error responseType was removed even when an error struct is declared.
defineRequest({ error: ApiError, method: 'GET', path: '/error-response-type', responseType: 'json' })

const useEmptyObject = defineRequest({ builder: () => ({}), method: 'POST', path: '/empty', input: struct.object({}) })
// @ts-expect-error a required root Struct still requires an input argument even when {} is a valid value.
useEmptyObject()
useEmptyObject({})

const useOptionalFields = defineRequest({
  builder: (input) => ({ query: { q: input.query } }),
  method: 'GET',
  path: '/search',
  input: struct.object({ query: struct.string().optional() }),
})
// @ts-expect-error optional fields do not make the root object optional.
useOptionalFields()
useOptionalFields({})

const useOptionalRoot = defineRequest({
  builder: () => ({}),
  method: 'POST',
  path: '/optional',
  input: struct.object({}).optional(),
})
useOptionalRoot()

const useUnionInput = defineRequest({
  builder: (input) => ({ body: input }),
  method: 'POST',
  path: '/union',
  input: struct.or(struct.string(), struct.number()),
})
// @ts-expect-error a required union input cannot be omitted.
useUnionInput()
useUnionInput('value')

const useOptionalRequestSections = defineRequest({
  builder: (input) => ({ headers: input.headers, query: input.query }),
  input: struct.object({
    headers: struct.object({ traceId: struct.string().optional() }).optional(),
    path: struct.object({ locale: struct.string().optional() }).optional(),
    query: struct.object({ page: struct.number().optional() }).optional(),
  }),
  method: 'GET',
  path: '/optional-sections',
})
useOptionalRequestSections({})
useOptionalRequestSections({ query: { page: 1 } })
// @ts-expect-error the request root remains required even when every declared section is optional.
useOptionalRequestSections()

const useMixedRequestSection = defineRequest({
  builder: (input) => input,
  input: struct.object({ query: struct.object({ page: struct.number().optional(), q: struct.string() }) }),
  method: 'GET',
  path: '/mixed-section',
})
useMixedRequestSection({ query: { q: 'defjs' } })
// @ts-expect-error a section with any required field cannot be omitted.
useMixedRequestSection({})

const useOptionalBodyFields = defineRequest({
  builder: (input) => input,
  input: struct.object({ body: struct.object({ note: struct.string().optional() }) }),
  method: 'POST',
  path: '/body',
})
useOptionalBodyFields({ body: {} })
// @ts-expect-error all-optional body fields do not make the body section optional.
useOptionalBodyFields({})

declare const result: HttpAwaitResult<{ name: string }, { code: string }>
const [error, data, response] = result

if (error) {
  expectTypeOf(data).toEqualTypeOf<undefined>()
  expectTypeOf(response).toEqualTypeOf<undefined>()
} else {
  expectTypeOf(data).toEqualTypeOf<{ name: string }>()
  expectTypeOf(response).toEqualTypeOf<DecodedResponse<{ name: string }>>()
  expectTypeOf(response.ok).toEqualTypeOf<boolean>()
}

export type Cases = true
