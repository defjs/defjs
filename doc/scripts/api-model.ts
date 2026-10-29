import { spawnSync } from "node:child_process";
import { firstParagraph } from "../app/lib/api-text";

export type ApiKind = "function" | "type" | "constant";

export interface StoredEntry {
  name: string;
  description: string;
  type: string;
  simplifiedType: string;
  required: boolean;
  deprecated: boolean;
  tags: { name: string; text: string }[];
  typeHref?: string;
}

export interface ApiOverload {
  signature: string;
  parameters: StoredEntry[];
  returns: string[];
}

export interface ApiReferenceEntry {
  package: string;
  name: string;
  kind: ApiKind;
  slug: string;
  /** Repo-relative path of the declaration file. */
  source: string;
  group: string;
  description: string;
  signatures: string[];
  related: string[];
  exampleFiles: { path: string; region: string; code: string }[];
  returns: string[];
  throws: string[];
  tags: { name: string; text: string }[];
  typeTable: StoredEntry[] | null;
  parameters: StoredEntry[];
  overloads: ApiOverload[];
}

export interface WorkerEntry {
  name: string;
  description: string;
  type: string;
  simplifiedType: string;
  required: boolean;
  deprecated: boolean;
  tags: { name: string; text: string }[];
  typeHref?: string;
}

export interface ParamDraft {
  name: string;
  required: boolean;
  typeText: string;
  description: string;
}

export function defined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

export function projectChecker<T>(program: {
  project?: { checker?: T } | undefined;
}): T {
  const checker = program.project?.checker;
  if (checker === undefined)
    throw new Error("TypeScript program has no checker");
  return checker;
}

export function catalogKind(options: {
  typeOnlyExport: boolean;
  declarationKind: "function" | "class" | "variable" | "type";
}): ApiKind {
  if (options.typeOnlyExport) return "type";
  if (options.declarationKind === "class" || options.declarationKind === "type")
    return "type";
  if (options.declarationKind === "function") return "function";
  return "constant";
}

export function parameterRequired(options: {
  rest: boolean;
  optional: boolean;
  initialized: boolean;
}): boolean {
  return !options.rest && !options.optional && !options.initialized;
}

export function typeOnlyExport(flags: readonly boolean[]): boolean {
  if (flags.length === 0) return false;
  return flags.every((flag) => flag);
}

export function overloadNodes<T extends { kind: number; body?: unknown }>(
  nodes: readonly T[],
  functionKind: number,
): T[] {
  const functions = nodes.filter((node) => node.kind === functionKind);
  const heads = functions.filter((node) => node.body === undefined);
  if (heads.length > 0) return heads;
  return functions.slice(0, 1);
}

export function implementationNode<T extends { kind: number }>(
  nodes: readonly T[],
  specifierKind: number,
  assignmentKind: number,
): T {
  return defined(
    nodes.find(
      (node) => node.kind !== specifierKind && node.kind !== assignmentKind,
    ),
    "implementation declaration",
  );
}

export function requireKind(
  kind: number,
  expected: number,
  label: string,
): void {
  if (kind !== expected) throw new Error(label);
}

export function parameterTypeText(typeText: string | undefined): string {
  const text = typeText?.trim();
  if (!text) return "unknown";
  return text;
}

export function stableMemberName(name: string): string {
  if (/^__[@#]/.test(name)) throw new Error(`unstable member name: ${name}`);
  return name;
}

export function lookupDescription(
  map: ReadonlyMap<string, string> | null,
  name: string,
): string {
  if (!map) return "";
  return map.get(name) ?? "";
}

export function memberDescription(
  fromTable: string,
  fromTarget: string,
): string {
  const table = fromTable.trim();
  if (table) return table;
  return fromTarget.trim();
}

export function nestedExpression(
  node: { kind: number } | undefined,
  wrappers: readonly number[],
): { kind: number } | undefined {
  let current = node;
  while (current && wrappers.includes(current.kind)) {
    const inner = (current as { expression?: { kind: number } | undefined })
      .expression;
    if (!inner) return undefined;
    current = inner;
  }
  return current;
}

export function objectPropertyName(
  text: string,
  kind: "identifier" | "other" | number,
  identifierKind?: number,
): string {
  const identifier =
    kind === "identifier" ||
    (typeof kind === "number" && kind === identifierKind);
  if (!identifier) throw new Error(`unsupported struct property name: ${text}`);
  return text;
}

export function storedEntry(entry: WorkerEntry): StoredEntry {
  const stored: StoredEntry = {
    name: stableMemberName(entry.name),
    description: entry.description,
    type: entry.type,
    simplifiedType: entry.simplifiedType,
    required: entry.required,
    deprecated: entry.deprecated,
    tags: entry.tags.map((tag) => ({ name: tag.name, text: tag.text })),
  };
  if (entry.typeHref) stored.typeHref = entry.typeHref;
  return stored;
}

/** Tuple index rows and undocumented symbol keys are not part of the public table. */
export function visibleMembers(rows: readonly StoredEntry[]): StoredEntry[] {
  const tuple = rows.some((row) => row.name === "0");
  return rows.filter((row) => {
    if (row.tags.some((tag) => tag.name.toLowerCase() === "internal"))
      return false;
    if (/^\[[A-Za-z0-9_]+\]$/.test(row.name) && !row.description.trim())
      return false;
    if (tuple && (row.name === "length" || /^\d+$/.test(row.name)))
      return false;
    return true;
  });
}

export function preferredParameterType(
  declared: string,
  generated: string,
): string {
  if (!declared || declared === "unknown") return generated;
  if (generated.includes("never") || generated.length > declared.length + 80)
    return declared;
  return generated;
}

export function zipParameters(
  drafts: readonly ParamDraft[],
  generated: readonly WorkerEntry[],
): StoredEntry[] {
  if (drafts.length !== generated.length)
    return drafts.map((draft) => ({
      name: draft.name,
      description: draft.description,
      type: draft.typeText,
      simplifiedType: draft.typeText,
      required: draft.required,
      deprecated: false,
      tags: [],
    }));
  return drafts.map((draft, index) => {
    const stored = storedEntry(defined(generated[index], "parameter entry"));
    const type = preferredParameterType(draft.typeText, stored.type);
    return {
      ...stored,
      name: draft.name,
      type,
      simplifiedType: type === stored.type ? stored.simplifiedType : type,
      required: draft.required,
      description: stored.description.trim()
        ? stored.description
        : draft.description,
    };
  });
}

export function isBindingPattern(name: string): boolean {
  return name.startsWith("{") || name.startsWith("[");
}

/** A bare type name, not an inline object or union. */
export function namedParameterType(type: string): string | undefined {
  const text = type.trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) return text;
  return undefined;
}

function copyStored(row: StoredEntry): StoredEntry {
  const stored: StoredEntry = {
    name: row.name,
    description: row.description,
    type: row.type,
    simplifiedType: row.simplifiedType,
    required: row.required,
    deprecated: row.deprecated,
    tags: row.tags.map((tag) => ({ name: tag.name, text: tag.text })),
  };
  if (row.typeHref) stored.typeHref = row.typeHref;
  return stored;
}

export function expandParameterList(
  parameters: readonly StoredEntry[],
  tables: ReadonlyMap<string, readonly StoredEntry[]>,
): StoredEntry[] {
  const expanded: StoredEntry[] = [];
  for (const parameter of parameters) {
    if (!isBindingPattern(parameter.name)) {
      expanded.push(parameter);
      continue;
    }
    const typeName = namedParameterType(parameter.type);
    if (typeName === undefined) {
      expanded.push(parameter);
      continue;
    }
    const table = tables.get(typeName);
    if (table === undefined || table.length === 0)
      throw new Error(
        `binding parameter type has no member table: ${typeName}`,
      );
    for (const row of table) expanded.push(copyStored(row));
  }
  return expanded;
}

export function expandBindingParameters(entries: ApiReferenceEntry[]): void {
  const tables = new Map<string, StoredEntry[]>();
  for (const entry of entries) {
    if (entry.typeTable) tables.set(entry.name, entry.typeTable);
  }
  for (const entry of entries) {
    entry.parameters = expandParameterList(entry.parameters, tables);
    for (const overload of entry.overloads)
      overload.parameters = expandParameterList(overload.parameters, tables);
  }
}

export function zipOverloads(
  signatures: readonly string[],
  parameterSets: readonly StoredEntry[][],
  returns: readonly string[],
): ApiOverload[] {
  if (signatures.length !== parameterSets.length)
    throw new Error(
      `signature/parameter mismatch ${signatures.length} vs ${parameterSets.length}`,
    );
  return signatures.map((signature, index) => ({
    signature,
    parameters: defined(parameterSets[index], "overload parameters"),
    returns: [...returns],
  }));
}

function copyEntry(item: StoredEntry): StoredEntry {
  const stored: StoredEntry = {
    name: item.name,
    description: item.description,
    type: item.type,
    simplifiedType: item.simplifiedType,
    required: item.required,
    deprecated: item.deprecated,
    tags: item.tags.map((tag) => ({ name: tag.name, text: tag.text })),
  };
  if (item.typeHref) stored.typeHref = item.typeHref;
  return stored;
}

/** Fixed key order so two generations stringify to the same bytes. */
export function referenceRecord(entry: ApiReferenceEntry): ApiReferenceEntry {
  return {
    package: entry.package,
    name: entry.name,
    kind: entry.kind,
    slug: entry.slug,
    source: entry.source,
    group: entry.group,
    description: entry.description,
    signatures: [...entry.signatures],
    related: [...entry.related],
    exampleFiles: entry.exampleFiles.map((file) => ({
      path: file.path,
      region: file.region,
      code: file.code,
    })),
    returns: [...entry.returns],
    throws: [...entry.throws],
    tags: entry.tags.map((tag) => ({ name: tag.name, text: tag.text })),
    typeTable: entry.typeTable === null ? null : entry.typeTable.map(copyEntry),
    parameters: entry.parameters.map(copyEntry),
    overloads: entry.overloads.map((overload) => ({
      signature: overload.signature,
      parameters: overload.parameters.map(copyEntry),
      returns: [...overload.returns],
    })),
  };
}

export interface FormatResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function defaultFormat(source: string, filename: string): FormatResult {
  const result = spawnSync("bun", ["fmt", `--stdin-filepath=${filename}`], {
    input: source,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** `bun fmt` is the print-width rule for checked-in JSON. Two runs stay byte-identical. */
export function formatJsonDocument(
  source: string,
  filename: string,
  run: (source: string, filename: string) => FormatResult = defaultFormat,
): string {
  const result = run(source, filename);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "no output";
    throw new Error(`bun fmt failed for ${filename}: ${detail}`);
  }
  return result.stdout;
}

export function serializeCatalog(
  entries: readonly Pick<
    ApiReferenceEntry,
    "package" | "name" | "kind" | "slug" | "related"
  >[],
): string {
  const rows = entries.map((entry) => ({
    package: entry.package,
    name: entry.name,
    kind: entry.kind,
    slug: entry.slug,
    related: [...entry.related],
  }));
  return formatJsonDocument(
    `${JSON.stringify(rows, null, 2)}\n`,
    "api-entries.json",
  );
}

export function serializeSummaries(
  entries: readonly ApiReferenceEntry[],
): string {
  const rows = entries.map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    description: firstParagraph(entry.description),
  }));
  return formatJsonDocument(
    `${JSON.stringify(rows, null, 2)}\n`,
    "api-summaries.json",
  );
}

export function serializeReference(
  entries: readonly ApiReferenceEntry[],
): string {
  return formatJsonDocument(
    `${JSON.stringify(entries.map(referenceRecord), null, 2)}\n`,
    "api-reference.json",
  );
}
