import type { DecodedResponse, HttpMeta } from "../internal/http_response";
import type { Fault, FaultClass, FaultCode } from "./types";
import { struct } from "../struct";

type IsAny<T> = 0 extends 1 & T ? true : false;
type StrictEqual<A, B> =
  IsAny<A> extends true
    ? false
    : IsAny<B> extends true
      ? false
      : [A] extends [B]
        ? [B] extends [A]
          ? true
          : false
        : false;
type Expect<T extends true> = T;

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  nickname: struct.string().optional(),
  displayName: struct.string().alias("display_name"),
});
const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
  details: struct.array(struct.string()).optional(),
});

// ---------------------------------------------------------------------------
// Philosophy 1 + 2: a declared `error` struct types `data` and `response.body`.
// ---------------------------------------------------------------------------
declare const declaredFault: Fault<typeof ApiError>;

function assertDeclaredErrorBody(): void {
  if (declaredFault.code === "HTTP_STATUS") {
    const code: string = declaredFault.data.code;
    const message: string = declaredFault.data.message;
    const details: string[] | undefined = declaredFault.data.details;
    const status: number = declaredFault.status;
    const bodyCode: string = declaredFault.response.body.code;
    void [code, message, details, status, bodyCode];
  }
}
void assertDeclaredErrorBody;

// ---------------------------------------------------------------------------
// Philosophy 5: omitting `error` skips decoding, so there is no body at all.
// ---------------------------------------------------------------------------
declare const undeclaredFault: Fault<undefined>;

function assertUndeclaredErrorBody(): void {
  if (undeclaredFault.code === "HTTP_STATUS") {
    const data: undefined = undeclaredFault.data;
    const status: number = undeclaredFault.response.status;
    void [data, status];
  }
}
void assertUndeclaredErrorBody;

// ---------------------------------------------------------------------------
// Philosophy 4: a failed decode has metadata and a cause, never a body.
// ---------------------------------------------------------------------------
function assertDecodeFault(): void {
  if (declaredFault.code === "RES_STRUCT_MISMATCH") {
    const status: number = declaredFault.response.status;
    const headers: Headers = declaredFault.response.headers;
    const url: string = declaredFault.response.url;
    const ok: boolean = declaredFault.response.ok;
    const cause: unknown = declaredFault.cause;
    void [status, headers, url, ok, cause];
  }
}
void assertDecodeFault;

// ---------------------------------------------------------------------------
// Preflight faults never reached a response, so they carry no status.
// ---------------------------------------------------------------------------
function assertPreflightFault(): void {
  if (declaredFault.code === "NET_TIMEOUT") {
    const cause: unknown = declaredFault.cause;
    const response: HttpMeta | undefined = declaredFault.response;
    void [cause, response];
  }
}
void assertPreflightFault;

// ---------------------------------------------------------------------------
// The code set is closed, so `switch` narrowing is exhaustive.
// ---------------------------------------------------------------------------
function triage(fault: Fault<typeof ApiError>): string {
  switch (fault.code) {
    case "HTTP_STATUS":
      return `status ${fault.status}: ${fault.data.code}`;
    case "RES_MEDIA_TYPE_INVALID":
    case "RES_DECODE_FAILED":
    case "RES_STRUCT_MISMATCH":
      return `broken contract ${fault.response.status}`;
    case "NET_TIMEOUT":
    case "NET_ABORTED":
    case "NET_UNREACHABLE":
    case "NET_BODY_INCOMPLETE":
      return "retryable";
    case "REQ_INPUT_INVALID":
    case "REQ_OPTIONS_INVALID":
    case "REQ_BUILD_FAILED":
      return "caller bug";
    case "EXT_INTERCEPTOR_FAILED":
    case "EXT_HOOK_FAILED":
    case "EXT_OBSERVER_FAILED":
      return "extension bug";
    case "CAP_BUFFER_EXCEEDED":
    case "CAP_QUEUE_OVERFLOW":
      return "capacity";
    case "ENV_UNSUPPORTED":
      return "environment";
    default: {
      const exhaustive: never = fault;
      return exhaustive;
    }
  }
}
void triage;

// ---------------------------------------------------------------------------
// The class is derived from the code prefix; there is no separate `kind` field.
// ---------------------------------------------------------------------------
type Classes = FaultClass<FaultCode>;
type ClassCases = Expect<
  StrictEqual<Classes, "CAP" | "ENV" | "EXT" | "HTTP" | "NET" | "REQ" | "RES">
>;
type NetworkClass = Expect<StrictEqual<FaultClass<"NET_TIMEOUT">, "NET">>;

// ---------------------------------------------------------------------------
// A decoded response adds `body` on top of the shared metadata.
// ---------------------------------------------------------------------------
type MetaKeys = Expect<
  StrictEqual<
    keyof HttpMeta,
    "headers" | "ok" | "status" | "statusText" | "url"
  >
>;
type DecodedKeys = Expect<
  StrictEqual<keyof DecodedResponse<string>, "body" | keyof HttpMeta>
>;
type DecodedBody = Expect<
  StrictEqual<DecodedResponse<typeof User>["body"], typeof User>
>;

// ---------------------------------------------------------------------------
// Negative cases.
// ---------------------------------------------------------------------------

void (declaredFault.code === "RES_STRUCT_MISMATCH"
  ? // @ts-expect-error Philosophy 4: a struct mismatch decoded nothing, so there is no body.
    declaredFault.response.body
  : null);
void (declaredFault.code === "RES_DECODE_FAILED"
  ? // @ts-expect-error Philosophy 4: an unreadable representation decoded nothing, so there is no body.
    declaredFault.response.body
  : null);
void (declaredFault.code === "RES_MEDIA_TYPE_INVALID"
  ? // @ts-expect-error Philosophy 4: a rejected media type is never decoded, so there is no body.
    declaredFault.response.body
  : null);
// @ts-expect-error A failed decode produced no value, so there is no `data` either.
void (declaredFault.code === "RES_DECODE_FAILED" ? declaredFault.data : null);
void (undeclaredFault.code === "HTTP_STATUS"
  ? // @ts-expect-error Philosophy 5: omitting `error` skips decoding, so the response has no body.
    undeclaredFault.response.body
  : null);
// @ts-expect-error A preflight fault never reached a response, so it carries no status.
void (declaredFault.code === "NET_TIMEOUT" ? declaredFault.status : null);
// @ts-expect-error The code set is closed: extensions report through `cause`, not a new code.
const customCode: FaultCode = "X_MY_OWN_CODE";
void customCode;

export type Cases =
  ClassCases | DecodedBody | DecodedKeys | MetaKeys | NetworkClass;
