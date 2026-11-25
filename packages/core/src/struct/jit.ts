import { decodeBigIntValue, decodeDateValue } from "./constructors";
import {
  MAX_DEPTH,
  type ArrayDefinition,
  type CompiledParser,
  type ObjectDefinition,
  type ResolvedStructField,
} from "./definition";
import { expectedType } from "./errors";
import { reject, type ParseNodeFn, type ParseState } from "./parse_state";
import { isPlainObject, nullObject } from "./plain_object";
import { resolveStructFields } from "./shape";
import { DEFINITION, FAILED } from "./symbols";
import type { StructIssue } from "./types";

const MAX_DEPTH_EXPECTED = `value nested at most ${MAX_DEPTH} levels deep`;
const HAS_OWN = Object.hasOwn;

let jitSupport: boolean | undefined;

export function supportsJit(): boolean {
  if (jitSupport !== undefined) {
    return jitSupport;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- PERF: probe whether dynamic code generation is permitted by CSP; falls back to interpreter when disallowed
    void new globalThis.Function("");
    jitSupport = true;
  } catch {
    jitSupport = false;
  }
  return jitSupport;
}

export function __resetJitSupportForTests(): void {
  jitSupport = undefined;
}

function rk(
  state: ParseState,
  segment: string | number,
  code: StructIssue["code"],
  expected: string,
  received: unknown,
): typeof FAILED {
  reject(state, true, code, expected, received);
  state.issue.path.push(segment);
  return FAILED;
}

function compileFunction(
  paramNames: readonly string[],
  body: string,
  deps: readonly unknown[],
): CompiledParser {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/consistent-type-assertions -- PERF: compiled object/array parsers eliminate per-field switch/dispatch/path overhead (~4-8x faster); callers guard with supportsJit() and fall back when eval is blocked
  const factory = new globalThis.Function(...paramNames, body) as (
    ...args: readonly unknown[]
  ) => CompiledParser;
  return factory(...deps);
}

function lazyObjectRunner(
  definition: ObjectDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser {
  let compiled: CompiledParser | undefined;
  return (state, input, depth) => {
    compiled ??= compileObjectTrusted(definition, aliases, parseNode);
    return compiled(state, input, depth);
  };
}

function lazyArrayRunner(
  definition: ArrayDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser {
  let compiled: CompiledParser | undefined;
  return (state, input, depth) => {
    compiled ??= compileArrayTrusted(definition, aliases, parseNode);
    return compiled(state, input, depth);
  };
}

const OBJ_PARAM_NAMES = [
  "P",
  "N",
  "H",
  "R",
  "K",
  "D",
  "B",
  "G",
  "F",
  "M",
  "E",
] as const;

function buildObjectParser(
  fields: readonly ResolvedStructField[],
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser {
  const paramNames: string[] = [...OBJ_PARAM_NAMES];
  const deps: unknown[] = [
    isPlainObject,
    nullObject,
    HAS_OWN,
    reject,
    rk,
    decodeDateValue,
    decodeBigIntValue,
    parseNode,
    FAILED,
    MAX_DEPTH,
    MAX_DEPTH_EXPECTED,
  ];
  const refs: unknown[] = [];

  const addRef = (value: unknown): string => {
    const idx = refs.length;
    refs.push(value);
    return `r[${idx}]`;
  };
  const fail = (k: string, code: string, e: string, rec: string): string =>
    `return K(s,${k},"${code}",${e},${rec})`;
  const emitDecode = (fn: string, k: string, e: string): string =>
    `t=${fn}(v,F);if(t===F)${fail(k, "invalid_type", e, "v")};o[${k}]=t;`;
  const emitCall = (expr: string, k: string): string =>
    `t=${expr};if(t===F){s.issue.path.push(${k});return F}o[${k}]=t;`;

  const chunks: string[] = [
    'return(s,x,d)=>{if(!P(x))return R(s,!0,"invalid_type","object",x);if(d>=M)return R(s,!0,"invalid_type",E,x);const o=N();let v,t;',
  ];

  for (const field of fields) {
    const inKey = JSON.stringify(aliases ? field.wireKey : field.key);
    const k = JSON.stringify(field.key);
    const def = field.struct[DEFINITION];
    const optional = def.flags.optional;
    const nullable = def.flags.nullable;
    const e = JSON.stringify(expectedType(def));

    chunks.push(`if(H(x,${inKey})){v=x[${inKey}];`);
    if (optional) {
      chunks.push("if(v!==void 0){");
    } else {
      chunks.push(`if(v===void 0)${fail(k, "missing_key", e, "v")};`);
    }

    if (nullable) {
      chunks.push(`if(v===null){o[${k}]=null}else{`);
    } else if (def.kind !== "or" && def.kind !== "intersection") {
      chunks.push(`if(v===null)${fail(k, "invalid_type", e, "null")};`);
    }

    switch (def.kind) {
      case "any":
      case "unknown":
        chunks.push(`o[${k}]=v;`);
        break;
      case "string":
        chunks.push(
          def.decode === undefined
            ? `if(typeof v!=="string")${fail(k, "invalid_type", e, "v")};o[${k}]=v;`
            : emitDecode(addRef(def.decode), k, e),
        );
        break;
      case "number":
        chunks.push(
          def.decode === undefined
            ? `if(typeof v!=="number"||v!==v)${fail(k, "invalid_type", e, "v")};o[${k}]=v;`
            : emitDecode(addRef(def.decode), k, e),
        );
        break;
      case "boolean":
        chunks.push(
          def.decode === undefined
            ? `if(typeof v!=="boolean")${fail(k, "invalid_type", e, "v")};o[${k}]=v;`
            : emitDecode(addRef(def.decode), k, e),
        );
        break;
      case "null":
        chunks.push(
          `if(v!==null)${fail(k, "invalid_type", '"null"', "v")};o[${k}]=null;`,
        );
        break;
      case "date":
        chunks.push(
          emitDecode(
            def.decode === decodeDateValue ? "D" : addRef(def.decode),
            k,
            e,
          ),
        );
        break;
      case "bigint":
        chunks.push(
          emitDecode(
            def.decode === decodeBigIntValue ? "B" : addRef(def.decode),
            k,
            e,
          ),
        );
        break;
      case "blob":
      case "file":
      case "arrayBuffer":
        chunks.push(
          def.decode === undefined
            ? `if(!${addRef(def.is)}(v))${fail(k, "invalid_type", e, "v")};o[${k}]=v;`
            : emitDecode(addRef(def.decode), k, e),
        );
        break;
      case "literal":
        chunks.push(
          `if(!Object.is(v,${addRef(def.value)}))${fail(k, "invalid_literal", e, "v")};o[${k}]=v;`,
        );
        break;
      case "enum":
        if (
          def.values.length <= 4 &&
          def.values.every((item) => typeof item === "string")
        ) {
          const cond = def.values
            .map((item) => `v!==${JSON.stringify(item)}`)
            .join("&&");
          chunks.push(
            `if(${cond})${fail(k, "invalid_enum", e, "v")};o[${k}]=v;`,
          );
        } else {
          const setRef = addRef((def.valueSet ??= new Set(def.values)));
          chunks.push(
            `if(!${setRef}.has(v))${fail(k, "invalid_enum", e, "v")};o[${k}]=v;`,
          );
        }
        break;
      case "object":
        chunks.push(
          emitCall(
            `${addRef(lazyObjectRunner(def, aliases, parseNode))}(s,v,d+1)`,
            k,
          ),
        );
        break;
      case "array":
        chunks.push(
          emitCall(
            `${addRef(lazyArrayRunner(def, aliases, parseNode))}(s,v,d+1)`,
            k,
          ),
        );
        break;
      case "discriminatedUnion":
      case "intersection":
      case "or":
      case "record":
      case "tuple":
        chunks.push(
          emitCall(`G(s,${addRef(field.struct)},v,"field",!0,d+1)`, k),
        );
        break;
    }

    if (nullable) chunks.push("}");
    if (optional) chunks.push("}");
    chunks.push("}");
    if (!optional) {
      chunks.push(`else ${fail(k, "missing_key", e, "void 0")};`);
    }
  }

  chunks.push("return o}");

  if (refs.length > 0) {
    paramNames.push("r");
    deps.push(refs);
  }
  return compileFunction(paramNames, chunks.join(""), deps);
}

function buildArrayParser(
  definition: ArrayDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser {
  const item = definition.item;
  const itemDef = item[DEFINITION];
  const paramNames: string[] = ["R", "K", "F", "M", "E"];
  const deps: unknown[] = [reject, rk, FAILED, MAX_DEPTH, MAX_DEPTH_EXPECTED];

  let loopBody: string;
  if (
    !itemDef.flags.optional &&
    !itemDef.flags.nullable &&
    (itemDef.kind === "string" ||
      itemDef.kind === "number" ||
      itemDef.kind === "boolean") &&
    itemDef.decode === undefined
  ) {
    const check =
      itemDef.kind === "string"
        ? 'typeof v!=="string"'
        : itemDef.kind === "number"
          ? 'typeof v!=="number"||v!==v'
          : 'typeof v!=="boolean"';
    loopBody = `const v=x[i];if(${check})return K(s,i,"invalid_type","${itemDef.kind}",v);o[i]=v`;
  } else if (
    !itemDef.flags.optional &&
    !itemDef.flags.nullable &&
    (itemDef.kind === "object" || itemDef.kind === "array")
  ) {
    paramNames.push("C");
    deps.push(
      itemDef.kind === "object"
        ? lazyObjectRunner(itemDef, aliases, parseNode)
        : lazyArrayRunner(itemDef, aliases, parseNode),
    );
    const e = JSON.stringify(itemDef.kind);
    loopBody = `const v=x[i];if(v===void 0||v===null)return K(s,i,"invalid_type",${e},v);const t=C(s,v,d+1);if(t===F){s.issue.path.push(i);return F}o[i]=t`;
  } else {
    paramNames.push("G", "S");
    deps.push(parseNode, item);
    loopBody = `const t=G(s,S,x[i],"value",!0,d+1);if(t===F){s.issue.path.push(i);return F}o[i]=t`;
  }

  const body = `return(s,x,d)=>{if(!Array.isArray(x))return R(s,!0,"invalid_type","array",x);if(d>=M)return R(s,!0,"invalid_type",E,x);const l=x.length,o=new Array(l);for(let i=0;i<l;i++){${loopBody}}return o}`;
  return compileFunction(paramNames, body, deps);
}

function compileObjectTrusted(
  definition: ObjectDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser {
  const cached = aliases
    ? definition.cache.compiledWire
    : definition.cache.compiledLogical;
  if (cached) {
    return cached;
  }
  const fields = resolveStructFields(definition);
  const compiled = buildObjectParser(fields, aliases, parseNode);
  if (aliases) {
    definition.cache.compiledWire = compiled;
  } else {
    definition.cache.compiledLogical = compiled;
  }
  return compiled;
}

function compileArrayTrusted(
  definition: ArrayDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser {
  const cached = aliases ? definition.compiledWire : definition.compiledLogical;
  if (cached) {
    return cached;
  }
  const compiled = buildArrayParser(definition, aliases, parseNode);
  if (aliases) {
    definition.compiledWire = compiled;
  } else {
    definition.compiledLogical = compiled;
  }
  return compiled;
}

export function getCompiledObjectParser(
  definition: ObjectDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser | undefined {
  const cached = aliases
    ? definition.cache.compiledWire
    : definition.cache.compiledLogical;
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  if (!supportsJit()) {
    if (aliases) {
      definition.cache.compiledWire = null;
    } else {
      definition.cache.compiledLogical = null;
    }
    return undefined;
  }
  return compileObjectTrusted(definition, aliases, parseNode);
}

export function getCompiledArrayParser(
  definition: ArrayDefinition,
  aliases: boolean,
  parseNode: ParseNodeFn,
): CompiledParser | undefined {
  const cached = aliases ? definition.compiledWire : definition.compiledLogical;
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  if (!supportsJit()) {
    if (aliases) {
      definition.compiledWire = null;
    } else {
      definition.compiledLogical = null;
    }
    return undefined;
  }
  return compileArrayTrusted(definition, aliases, parseNode);
}
