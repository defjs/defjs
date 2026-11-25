import type { CliDiagnostic } from "../../../runtime/types.ts";
import type {
  OpenApiErrorStrategy,
  OpenApiMixed2xxStrategy,
} from "../types.ts";

export type PrimitiveKind =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "null"
  | "blob"
  | "file"
  | "unknown";

export interface ObjectFieldIr {
  readonly propName: string;
  readonly wireName: string;
  readonly schema: SchemaNode;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly description?: string;
  readonly constraints: readonly string[];
  readonly lazyGetter: boolean;
}

export interface SchemaRefNode {
  readonly kind: "ref";
  readonly id: string;
  readonly name: string;
}

export type SchemaNode =
  | { readonly kind: "primitive"; readonly primitive: PrimitiveKind }
  | {
      readonly kind: "literal";
      readonly value: string | number | boolean | null;
    }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "array"; readonly item: SchemaNode }
  | { readonly kind: "tuple"; readonly items: readonly SchemaNode[] }
  | { readonly kind: "record"; readonly value: SchemaNode }
  | { readonly kind: "object"; readonly fields: readonly ObjectFieldIr[] }
  | {
      readonly kind: "form";
      readonly codec: "formData" | "urlencoded";
      readonly fields: readonly ObjectFieldIr[];
    }
  | { readonly kind: "or"; readonly options: readonly SchemaNode[] }
  | {
      readonly kind: "discriminatedUnion";
      readonly tag: string;
      readonly options: readonly SchemaNode[];
    }
  | { readonly kind: "intersection"; readonly members: readonly SchemaNode[] }
  | { readonly kind: "nullable"; readonly inner: SchemaNode }
  | SchemaRefNode;

export interface SchemaDeclIr {
  readonly id: string;
  readonly name: string;
  readonly fileKey: string;
  readonly schema: SchemaNode;
  readonly description?: string;
  readonly constraints: readonly string[];
  readonly recursive: boolean;
  readonly references: ReadonlySet<string>;
  readonly role: "default" | "input";
}

export type QueryParamStyle =
  "form" | "deepObject" | "pipeDelimited" | "spaceDelimited" | "json";

export interface QueryFieldPlanIr {
  readonly propName: string;
  readonly wireName: string;
  readonly style: QueryParamStyle;
  readonly explode: boolean;
}

export type PathParamStyle = "simple" | "label" | "matrix";

export interface PathParamPlanIr {
  readonly templateName: string;
  readonly rawName: string;
  readonly propName: string;
  readonly style: PathParamStyle;
  readonly explode: boolean;
  readonly needsSerializer: boolean;
  readonly isJsonContent: boolean;
}

export interface HeaderParamPlanIr {
  readonly wireName: string;
  readonly propName: string;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly explode: boolean;
  readonly needsSerializer: boolean;
  readonly isJsonContent: boolean;
}

export interface BuilderPlanIr {
  readonly pathParams: readonly PathParamPlanIr[];
  readonly pathWrapperProp?: string;
  readonly hasQuery: boolean;
  readonly queryRequired: boolean;
  readonly customQueryFields?: readonly QueryFieldPlanIr[];
  readonly headers: readonly HeaderParamPlanIr[];
  readonly headersRequired: boolean;
  readonly hasBody: boolean;
}

export interface HttpOperationIr {
  readonly kind: "http";
  readonly name: string;
  readonly group: string;
  readonly method: string;
  readonly path: string;
  readonly description?: string;
  readonly mixed2xxNote?: string;
  readonly inputSchema?: SchemaRefNode;
  readonly inputOptional: boolean;
  readonly builder?: BuilderPlanIr;
  readonly outputSchema?: SchemaRefNode;
  readonly errorSchema?: SchemaRefNode;
}

export interface SseEventIr {
  readonly eventName: string;
  readonly schema: SchemaRefNode;
}

export interface SseOperationIr {
  readonly kind: "sse";
  readonly name: string;
  readonly group: string;
  readonly method: string;
  readonly path: string;
  readonly description?: string;
  readonly inputSchema?: SchemaRefNode;
  readonly inputOptional: boolean;
  readonly builder?: BuilderPlanIr;
  readonly events: readonly SseEventIr[];
  readonly errorSchema?: SchemaRefNode;
}

export type OperationIr = HttpOperationIr | SseOperationIr;

export interface LoweredBundle {
  readonly schemas: readonly SchemaDeclIr[];
  readonly operations: readonly OperationIr[];
  readonly groups: readonly string[];
  readonly diagnostics: readonly CliDiagnostic[];
}

export interface LoweringOptions {
  readonly errorStrategy: OpenApiErrorStrategy;
  readonly mixed2xxStrategy: OpenApiMixed2xxStrategy;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}
