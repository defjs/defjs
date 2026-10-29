import { expect, test } from "vitest";
import {
  cleanSignature,
  facadeSignature,
  finishSignature,
  parameterName,
  presentClass,
  readableBinding,
  returnTypeSuffix,
  suppressObjectSignature,
  cutEnd,
  annotatedTypeText,
  inferredTypeSuffix,
  initializerEnd,
  collapseMemberGaps,
  declaredParameterType,
  hideDefaultExpressions,
  omitInternalMembers,
  stripInnerDocs,
  typeParameterClause,
  withInferredType,
  withReturnType,
} from "./api-signature";

test("signature cleanup keeps the declaration and drops the body marker", () => {
  expect(
    cleanSignature(
      "export declare function createClient(...options: ClientOption[]): Client",
    ),
  ).toBe("function createClient(...options: ClientOption[]): Client;");
  expect(cleanSignature("export class StructError extends Error {")).toBe(
    "class StructError extends Error;",
  );
  expect(cleanSignature("export const struct =")).toBe("const struct;");
  expect(cleanSignature("function already(): void;")).toBe(
    "function already(): void;",
  );
  expect(cleanSignature("function already(): void;;")).toBe(
    "function already(): void;",
  );
  expect(
    facadeSignature(
      "function createAnyStruct(): Struct<PresentValue, any>;",
      "any",
    ),
  ).toBe("function any(): Struct<PresentValue, any>;");
  expect(
    facadeSignature(
      "function structEnum<const T>(\n  value: T,\n): Struct<T, T>;",
      "enum",
    ),
  ).toBe("function enum<const T>(\n  value: T,\n): Struct<T, T>;");
  expect(suppressObjectSignature(true, { kind: 1 }, 1)).toBe(false);
  expect(suppressObjectSignature(false, undefined, 1)).toBe(false);
  expect(suppressObjectSignature(false, { kind: 2 }, 1)).toBe(false);
  expect(suppressObjectSignature(false, { kind: 1 }, 1)).toBe(true);
  expect(
    stripInnerDocs("type Foo = {\n  /** hidden */\n  id: string;\n}"),
  ).toBe("type Foo = {\n\n  id: string;\n}");
});

test("a short inferred type is appended only when the source has no annotation", () => {
  expect(withInferredType("export const ERR_ABORTED =", "Error", false)).toBe(
    "const ERR_ABORTED: Error;",
  );
  expect(
    withInferredType(
      "export const HTTP_CLIENT: InjectionKey<Client> =",
      "symbol",
      true,
    ),
  ).toBe("const HTTP_CLIENT: InjectionKey<Client>;");
  expect(
    withInferredType(
      "export const struct =",
      "{ readonly any: unknown }",
      false,
    ),
  ).toBe("const struct;");
  expect(inferredTypeSuffix(undefined)).toBe("");
  expect(inferredTypeSuffix("")).toBe("");
  expect(inferredTypeSuffix("any")).toBe("");
  expect(inferredTypeSuffix("{\n  a: string;\n}")).toBe("");
  expect(inferredTypeSuffix("a\nb")).toBe("");
  expect(inferredTypeSuffix("x".repeat(81))).toBe("");
  expect(inferredTypeSuffix("Error")).toBe(": Error");
  expect(typeParameterClause("ignored", undefined)).toBe("");
  expect(typeParameterClause("function f", { pos: 0, end: 10 })).toBe("");
  expect(typeParameterClause(" < T extends Foo > ", { pos: 0, end: 18 })).toBe(
    "T extends Foo",
  );
  expect(cutEnd("members", 12, 40)).toBe(12);
  expect(cutEnd("body", undefined, 40)).toBe(40);
  expect(cutEnd("node", 12, 40)).toBe(40);
  expect(initializerEnd({ initializer: { getStart: () => 8 }, end: 20 })).toBe(
    8,
  );
  expect(initializerEnd({ end: 20 })).toBe(20);
  expect(annotatedTypeText(undefined)).toBeUndefined();
  expect(annotatedTypeText({ getText: () => "Client" })).toBe("Client");
});

test("public signatures hide internal members, defaults and blank member lines", () => {
  expect(
    cleanSignature(
      "export interface Foo {\n  /** @internal */\n  secret: string;\n\n  id: string;\n};",
    ),
  ).toBe("interface Foo {\n  id: string;\n}");
  expect(
    omitInternalMembers("/** @internal */ secret: string;\nid: string;"),
  ).toBe("id: string;");
  expect(omitInternalMembers("/** kept */\nid: string;")).toBe(
    "/** kept */\nid: string;",
  );
  expect(omitInternalMembers("/** still open\nid: string;")).toBe(
    "/** still open\nid: string;",
  );
  expect(omitInternalMembers("/** @internal still open")).toBe("");
  expect(
    omitInternalMembers(
      "/** @internal */\nhidden(): void {\n  const x = { a: 1 };\n}\nkept: string;",
    ),
  ).toBe("kept: string;");
  expect(
    hideDefaultExpressions("function f(: string = make()): void"),
  ).toContain("=");
  expect(hideDefaultExpressions("function f(name: = 1): void")).toContain(
    "name:",
  );
  expect(
    hideDefaultExpressions(
      "function fetchHandler(\n  fetchImpl: FetchHandle = resolveGlobalFetch(),\n): void",
    ),
  ).toBe("function fetchHandler(\n  fetchImpl?: FetchHandle,\n): void");
  expect(
    hideDefaultExpressions(
      'function createResolvedRequestUrl(queryString = ""): URL',
    ),
  ).toBe("function createResolvedRequestUrl(queryString?: string): URL");
  expect(
    hideDefaultExpressions(
      "function f<T = string>(value = 1, flag = false, name = 'a', raw = `b`): void",
    ),
  ).toBe(
    "function f<T = string>(value?: number, flag?: boolean, name?: string, raw?: string): void",
  );
  expect(hideDefaultExpressions("export const struct =")).toBe(
    "export const struct =",
  );
  expect(hideDefaultExpressions("a === b => c != d <= e >= f")).toBe(
    "a === b => c != d <= e >= f",
  );
  expect(hideDefaultExpressions('name: T = foo("a\\"b")')).toBe("name?: T");
  expect(hideDefaultExpressions("count = -2")).toBe("count?: number");
  expect(hideDefaultExpressions('T extends string = "GET"')).toBe(
    'T extends string = "GET"',
  );
  expect(
    hideDefaultExpressions("function f(value: Foo<Bar, Baz> = make()): void"),
  ).toBe("function f(value?: Foo<Bar, Baz>): void");
  expect(
    hideDefaultExpressions(
      'function f<const M extends string = "GET">(queryString = ""): void',
    ),
  ).toBe(
    'function f<const M extends string = "GET">(queryString?: string): void',
  );
  expect(collapseMemberGaps("a\n\n\n  \nb")).toBe("a\nb");
  expect(declaredParameterType(" string ", undefined)).toBe("string");
  expect(declaredParameterType(undefined, '""')).toBe("string");
  expect(declaredParameterType(undefined, "'a'")).toBe("string");
  expect(declaredParameterType(undefined, "`a`")).toBe("string");
  expect(declaredParameterType(undefined, "1.5")).toBe("number");
  expect(declaredParameterType(undefined, "-2")).toBe("number");
  expect(declaredParameterType(undefined, "true")).toBe("boolean");
  expect(declaredParameterType(undefined, "false")).toBe("boolean");
  expect(declaredParameterType(undefined, "resolve()")).toBe("unknown");
  expect(declaredParameterType(undefined, undefined)).toBe("unknown");
  expect(declaredParameterType("  ", "1")).toBe("number");
});

test("a generic function type default stays in the public signature", () => {
  const declaration = `
export interface SessionOptions {
  /** Periodic heartbeat ping and optional ACK matching. */
  heartbeat?: {
    /** Returns whether an incoming message acknowledges the heartbeat. */
    isAck?: (message: unknown) => boolean;
    /** Builds the outbound heartbeat payload. */
    message?: <T = unknown>() => T | unknown;
    /** Time to wait for an ACK before treating the connection as unhealthy. */
    timeoutMs?: number;
  };
}
`;
  expect(cleanSignature(declaration)).toBe(
    [
      "interface SessionOptions {",
      "  heartbeat?: {",
      "    isAck?: (message: unknown) => boolean;",
      "    message?: <T = unknown>() => T | unknown;",
      "    timeoutMs?: number;",
      "  };",
      "}",
    ].join("\n"),
  );
  expect(
    hideDefaultExpressions(
      "isAck?: (message: unknown) => boolean;\n    message?: <T = unknown>() => T | unknown;\n    timeoutMs?: number;",
    ),
  ).toBe(
    "isAck?: (message: unknown) => boolean;\n    message?: <T = unknown>() => T | unknown;\n    timeoutMs?: number;",
  );
});

test("a class signature keeps the public surface and drops bodies", () => {
  const declaration = `
export class StructError extends Error {
  /** Issues collected for this failure, in encounter order. */
  readonly issues: StructIssue[];

  /**
   * @param issues - Non-empty list of parse issues.
   */
  constructor(issues: StructIssue[]) {
    const first = issues[0]?.message;
    super(first ?? "Struct parse failed");
    this.name = "StructError";
    this.issues = issues;
  }

  /** Build a nested error tree keyed by path segments. */
  format(): FormattedStructError {
    const root = { _errors: [] as string[] };
    return root;
  }

  /** Split issues into root form errors and first-segment field errors. */
  flatten(): FlattenedStructError {
    const formErrors: string[] = [];
    const fieldErrors: { [key: string]: string[] } = {};
    return { fieldErrors, formErrors };
  }

  /** Render one human-readable line per issue. */
  prettify(): string {
    return this.issues.map((item) => item.message).join("\\n");
  }
}
`;
  expect(cleanSignature(declaration)).toBe(
    [
      "class StructError extends Error {",
      "  readonly issues: StructIssue[];",
      "  constructor(issues: StructIssue[]);",
      "  format(): FormattedStructError;",
      "  flatten(): FlattenedStructError;",
      "  prettify(): string;",
      "}",
    ].join("\n"),
  );
  expect(
    cleanSignature(`export class Foo<=T extends Bar<{ a: () => string }> {
  value: number;
  bag: { text: string };
  run(): Array<string> { return []; }
  constructor() { return; }
  #secret = 1;
  private hidden(): void { return; }
  protected no: number;
}`),
  ).toBe(
    [
      "class Foo<=T extends Bar<{ a: () => string }> {",
      "  value: number;",
      "  bag: { text: string };",
      "  run(): Array<string>;",
      "  constructor();",
      "}",
    ].join("\n"),
  );
  expect(cleanSignature("export class Tail {\n  value: number\n}")).toBe(
    "class Tail {\n  value: number;\n}",
  );
  expect(cleanSignature("export class Block {\n{ kept: number };\n}")).toBe(
    "class Block {\n  { kept: number };\n}",
  );
  expect(cleanSignature("export class Empty {}")).toBe("class Empty {}");
  expect(cleanSignature("class Header extends Error")).toBe(
    "class Header extends Error;",
  );
  expect(presentClass("function f(): void")).toBe("function f(): void");
  expect(parameterName("ClientProviderProps")).toBe("props");
  expect(parameterName("HttpClientConfig")).toBe("httpClientConfig");
});

test("leading async is removed and declarations end consistently", () => {
  expect(
    cleanSignature(
      "export async function fetchHandler(fetchImpl: FetchHandle = resolveGlobalFetch()): Promise<void>",
    ),
  ).toBe("function fetchHandler(fetchImpl?: FetchHandle): Promise<void>;");
  expect(
    cleanSignature(
      "export function ClientProvider({ client, children }: ClientProviderProps)",
    ),
  ).toBe("function ClientProvider(props: ClientProviderProps);");
  expect(
    cleanSignature("export function load({ value }: HttpClientConfig): void"),
  ).toBe("function load(httpClientConfig: HttpClientConfig): void;");
  expect(readableBinding("function f(value: string): void")).toBe(
    "function f(value: string): void",
  );
  expect(
    cleanSignature("export type HttpMeta = {\n  readonly ok: boolean;\n}"),
  ).toBe("type HttpMeta = {\n  readonly ok: boolean;\n};");
  expect(finishSignature("interface Foo {\n  id: string;\n}")).toBe(
    "interface Foo {\n  id: string;\n}",
  );
  expect(finishSignature("function f(): void;;")).toBe("function f(): void;");
  expect(withReturnType("function f(props: ClientProviderProps);", "any")).toBe(
    "function f(props: ClientProviderProps);",
  );
  expect(
    withReturnType(
      "function ClientProvider(props: ClientProviderProps);",
      "FunctionComponentElement<ProviderProps<Client | null>>",
    ),
  ).toBe(
    "function ClientProvider(props: ClientProviderProps): FunctionComponentElement<ProviderProps<Client | null>>;",
  );
  expect(withReturnType("function f(x: string): void;", "number")).toBe(
    "function f(x: string): void;",
  );
  expect(returnTypeSuffix(undefined)).toBe("");
  expect(returnTypeSuffix("")).toBe("");
  expect(returnTypeSuffix("x".repeat(201))).toBe("");
  expect(returnTypeSuffix("x".repeat(200))).toBe(`: ${"x".repeat(200)};`);
  expect(returnTypeSuffix("Array<...>")).toBe("");
  expect(returnTypeSuffix("a\nb")).toBe("");
  expect(returnTypeSuffix("any")).toBe("");
});
