import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  SymbolFlags,
  TypeFormatFlags,
} from "typescript/async";
import type {
  Checker,
  Program,
  RawCompilerOptions,
  Symbol,
} from "typescript/async";
import { SyntaxKind } from "typescript/ast";

export { SyntaxKind };
import type {
  ConstructorTypeNode,
  ExportSpecifier,
  FunctionDeclaration,
  FunctionTypeNode,
  Node,
  VariableDeclaration,
} from "typescript/ast";
import type { DocEntry } from "fumadocs-typescript";
import { compareApiIdentity } from "./api-order";
import { loadExample } from "./api-examples";
import {
  catalogKind,
  defined,
  implementationNode,
  lookupDescription,
  expandBindingParameters,
  memberDescription,
  nestedExpression,
  objectPropertyName,
  overloadNodes,
  parameterRequired,
  parameterTypeText,
  projectChecker,
  referenceRecord,
  requireKind,
  serializeCatalog,
  serializeReference,
  serializeSummaries,
  storedEntry,
  typeOnlyExport,
  visibleMembers,
  zipOverloads,
  zipParameters,
} from "./api-model";
import type { ApiReferenceEntry, ParamDraft, WorkerEntry } from "./api-model";
import { apiSlug } from "./api-slug";
import {
  annotatedTypeText,
  cleanSignature,
  declaredParameterType,
  cutEnd,
  facadeSignature,
  initializerEnd,
  suppressObjectSignature,
  typeParameterClause,
  withInferredType,
} from "./api-signature";
import { firstProse, paramDescription, storedTags, textsFor } from "./api-tags";
import type { DocTag } from "./api-tags";
import {
  identityIndex,
  resolveSee,
  singleGroup,
  unique,
  validateReference,
} from "./api-validate";
import { requestTypeTables } from "./api-worker";
import type { WorkerDoc } from "./api-worker";

const repoRoot = join(import.meta.dirname, "../..");
const docRoot = join(import.meta.dirname, "..");
const packages = [
  { name: "@defjs/core", entry: "packages/core/src/index.ts" },
  { name: "@defjs/react", entry: "packages/react/src/index.ts" },
  { name: "@defjs/vue", entry: "packages/vue/src/index.ts" },
  {
    name: "@defjs/opentelemetry-server",
    entry: "packages/opentelemetry-server/src/index.ts",
  },
] as const;

const compilerOptions = {
  noEmit: true,
  strict: true,
  target: 9,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  types: [] as string[],
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  baseUrl: repoRoot,
  paths: {
    "@defjs/core": ["packages/core/src/index.ts"],
    "@defjs/react": ["packages/react/src/index.ts"],
    "@defjs/vue": ["packages/vue/src/index.ts"],
    "@defjs/opentelemetry-server": [
      "packages/opentelemetry-server/src/index.ts",
    ],
  },
} as RawCompilerOptions;

/** Node child. `fumadocs-typescript` uses `typescript/sync`, which crashes inside Bun. */
export const workerSource = `
import { createGenerator } from "fumadocs-typescript";
import { readFileSync } from "node:fs";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const generator = createGenerator({ tsconfigPath: payload.tsconfigPath });
const docs = [];
for (const job of payload.jobs) {
  const content = readFileSync(job.file, "utf8") + "\\n" + job.suffix;
  for (const name of job.queries) {
    let generated;
    try {
      generated = await generator.generateDocumentation({ path: job.file, content }, name, {
        transform: function (entry, _type, symbol) {
          const declaration = symbol.valueDeclaration ?? (symbol.declarations ? symbol.declarations[0] : undefined);
          if (!declaration || typeof declaration.resolve !== "function") return;
          const node = declaration.resolve(this.program);
          if (node && typeof node.then === "function") {
            console.error("declaration.resolve returned a promise for " + name);
            process.exit(1);
          }
          const printed = node && node.name && typeof node.name.getText === "function" ? node.name.getText() : "";
          if (printed) entry.name = printed;
          const fileName = node && typeof node.getSourceFile === "function" ? node.getSourceFile().fileName : "";
          if (fileName && !fileName.includes("/packages/") && !fileName.includes("\\\\packages\\\\")) entry.name = "";
        },
      });
    } catch (error) {
      console.error("generateDocumentation failed for " + name + " in " + job.file + ": " + (error && error.message ? error.message : error));
      process.exit(1);
    }
    if (!generated || generated.length === 0) {
      console.error("no export " + name + " in " + job.file);
      process.exit(1);
    }
    const entries = [];
    for (const doc of generated) {
      for (const entry of doc.entries ?? []) {
        if (!entry.name) continue;
        const plain = {
          name: String(entry.name),
          description: String(entry.description ?? ""),
          type: String(entry.type ?? ""),
          simplifiedType: String(entry.simplifiedType ?? ""),
          required: Boolean(entry.required),
          deprecated: Boolean(entry.deprecated),
          tags: (entry.tags ?? []).map((tag) => ({ name: String(tag.name), text: String(tag.text ?? "") })),
        };
        if (entry.typeHref) plain.typeHref = String(entry.typeHref);
        entries.push(plain);
      }
    }
    entries.sort((left, right) => {
      const leftIndex = /^p(\\d+)$/.exec(left.name);
      const rightIndex = /^p(\\d+)$/.exec(right.name);
      if (leftIndex && rightIndex) return Number(leftIndex[1]) - Number(rightIndex[1]);
      return 0;
    });
    docs.push({ file: job.file, name, entries });
  }
}
process.stdout.write(JSON.stringify({ docs }), () => process.exit(0));
`;

export function declarationCategory(
  kind: SyntaxKind,
): "function" | "class" | "variable" | "type" {
  if (kind === SyntaxKind.FunctionDeclaration) return "function";
  if (kind === SyntaxKind.ClassDeclaration) return "class";
  if (kind === SyntaxKind.VariableDeclaration) return "variable";
  return "type";
}

export function specifierIsTypeOnly(node: {
  kind: number;
  isTypeOnly?: boolean | undefined;
  parent?:
    | {
        kind: number;
        parent?: { kind: number; isTypeOnly?: boolean | undefined } | undefined;
      }
    | undefined;
}): boolean {
  if (node.kind !== SyntaxKind.ExportSpecifier) return false;
  if (node.isTypeOnly) return true;
  const named = node.parent;
  if (!named || named.kind !== SyntaxKind.NamedExports) return false;
  const decl = named.parent;
  return Boolean(
    decl && decl.kind === SyntaxKind.ExportDeclaration && decl.isTypeOnly,
  );
}

export function functionTypeOf(node: {
  kind: number;
  type?: { kind: number; type?: { kind: number } | undefined } | undefined;
}): { kind: number } | undefined {
  let current:
    { kind: number; type?: { kind: number } | undefined } | undefined = node;
  while (current && current.kind === SyntaxKind.ParenthesizedType)
    current = current.type;
  if (!current) return undefined;
  if (
    current.kind === SyntaxKind.FunctionType ||
    current.kind === SyntaxKind.ConstructorType
  )
    return current;
  return undefined;
}

interface FileJob {
  file: string;
  suffix: string[];
  queries: string[];
  next: number;
}

interface ParameterQuery {
  file: string;
  query: string;
  drafts: ParamDraft[];
}

interface PageDraft {
  package: string;
  name: string;
  kind: ApiReferenceEntry["kind"];
  description: string;
  signatures: string[];
  seeTexts: string[];
  exampleSpecs: string[];
  returns: string[];
  throws: string[];
  tags: { name: string; text: string }[];
  group: string;
  source: string;
  typeTable: { file: string; query: string } | null;
  parameterQueries: ParameterQuery[];
  memberDescriptions: Map<string, string> | null;
}

function jobFor(jobs: Map<string, FileJob>, file: string): FileJob {
  const existing = jobs.get(file);
  if (existing) return existing;
  const created: FileJob = { file, suffix: [], queries: [], next: 0 };
  jobs.set(file, created);
  return created;
}

function addSynthetic(
  job: FileJob,
  clause: string,
  properties: string,
): string {
  const name = `__ApiParams_${job.next}`;
  job.next += 1;
  const params = clause ? `<${clause}>` : "";
  job.suffix.push(`export type ${name}${params} = {\n${properties}\n};`);
  job.queries.push(name);
  return name;
}

function outerStatement(node: Node): Node {
  let current = node;
  while (
    current.parent &&
    (current.parent.kind === SyntaxKind.VariableDeclarationList ||
      current.parent.kind === SyntaxKind.VariableStatement)
  )
    current = current.parent;
  return current;
}

async function resolveAll(symbol: Symbol): Promise<Node[]> {
  const nodes: Node[] = [];
  for (const handle of symbol.declarations)
    nodes.push(defined(await handle.resolve(), `${symbol.name} declaration`));
  return nodes;
}

function parameterPieces(
  node: FunctionDeclaration | FunctionTypeNode | ConstructorTypeNode,
  tags: readonly DocTag[],
): { drafts: ParamDraft[]; block: string; clause: string } {
  const fileText = node.getSourceFile().text;
  const drafts: ParamDraft[] = [];
  const lines: string[] = [];
  for (const [index, param] of node.parameters.entries()) {
    const sourceName = param.name.getText();
    const rest = param.dotDotDotToken !== undefined;
    const display = rest ? `...${sourceName}` : sourceName;
    const description = paramDescription(tags, display).replaceAll(
      "*/",
      "*\\/",
    );
    const typeText = parameterTypeText(
      declaredParameterType(
        annotatedTypeText(param.type),
        param.initializer?.getText(),
      ),
    );
    drafts.push({
      name: display,
      required: parameterRequired({
        rest,
        optional: param.questionToken !== undefined,
        initialized: param.initializer !== undefined,
      }),
      typeText,
      description,
    });
    lines.push(`  /** ${description} */\n  p${index}: ${typeText};`);
  }
  return {
    drafts,
    block: lines.join("\n"),
    clause: typeParameterClause(fileText, node.typeParameters),
  };
}

async function callablePages(
  nodes: readonly Node[],
  tags: readonly DocTag[],
  jobs: Map<string, FileJob>,
): Promise<{ signatures: string[]; parameterQueries: ParameterQuery[] }> {
  const selected = overloadNodes(nodes, SyntaxKind.FunctionDeclaration);
  const signatures: string[] = [];
  const parameterQueries: ParameterQuery[] = [];
  for (const node of selected) {
    const fn = node as FunctionDeclaration;
    const fileText = fn.getSourceFile().text;
    let signature = cleanSignature(
      fileText.slice(fn.getStart(), cutEnd("body", fn.body?.pos, fn.end)),
    );
    signatures.push(signature);
    const pieces = parameterPieces(fn, tags);
    const file = fn.getSourceFile().fileName;
    parameterQueries.push({
      file,
      query:
        pieces.drafts.length > 0
          ? addSynthetic(jobFor(jobs, file), pieces.clause, pieces.block)
          : "",
      drafts: pieces.drafts,
    });
  }
  return { signatures, parameterQueries };
}

async function readPage(
  packageName: string,
  name: string,
  symbol: Symbol,
  exportNodes: readonly Node[],
  checker: Checker,
  jobs: Map<string, FileJob>,
  includeTypeTable: boolean,
): Promise<PageDraft> {
  const aliased =
    (symbol.flags & SymbolFlags.Alias) !== 0
      ? await checker.getAliasedSymbol(symbol)
      : symbol;
  const nodes = await resolveAll(aliased);
  const impl = implementationNode(
    nodes,
    SyntaxKind.ExportSpecifier,
    SyntaxKind.ExportAssignment,
  );
  const tags = (await checker.getJsDocTagsOfSymbol(
    aliased,
  )) as readonly DocTag[];
  const kind = catalogKind({
    typeOnlyExport: typeOnlyExport(
      exportNodes.map((node) => specifierIsTypeOnly(node as ExportSpecifier)),
    ),
    declarationKind: declarationCategory(impl.kind),
  });
  const groups = nodes.flatMap((node) => [
    outerStatement(node).jsDoc,
    node.jsDoc,
  ]);
  let signatures: string[] = [];
  let parameterQueries: ParameterQuery[] = [];
  let table: PageDraft["typeTable"] = null;
  const file = impl.getSourceFile().fileName;
  const fileText = impl.getSourceFile().text;
  if (impl.kind === SyntaxKind.FunctionDeclaration) {
    const callable = await callablePages(nodes, tags, jobs);
    signatures = callable.signatures;
    parameterQueries = callable.parameterQueries;
  } else if (impl.kind === SyntaxKind.TypeAliasDeclaration) {
    signatures = [cleanSignature(impl.getText())];
    const callable = functionTypeOf((impl as unknown as { type: Node }).type);
    if (callable) {
      const pieces = parameterPieces(callable as FunctionTypeNode, tags);
      parameterQueries = [
        {
          file,
          query: syntheticQuery(pieces.drafts.length, () =>
            addSynthetic(jobFor(jobs, file), pieces.clause, pieces.block),
          ),
          drafts: pieces.drafts,
        },
      ];
    } else if (
      typeAliasHasMembers(
        impl as unknown as {
          kind: number;
          type?: { kind: number; type?: { kind: number } };
        },
      )
    )
      table = typeTableQuery(includeTypeTable, file, name);
  } else if (impl.kind === SyntaxKind.ClassDeclaration) {
    signatures = [cleanSignature(impl.getText())];
    table = typeTableQuery(includeTypeTable, file, name);
  } else if (impl.kind === SyntaxKind.VariableDeclaration) {
    const variable = impl as VariableDeclaration;
    const initializer = nestedExpression(variable.initializer, [
      SyntaxKind.AsExpression,
      SyntaxKind.SatisfiesExpression,
      SyntaxKind.ParenthesizedExpression,
    ]);
    if (
      suppressObjectSignature(
        variable.type !== undefined,
        initializer,
        SyntaxKind.ObjectLiteralExpression,
      )
    ) {
      signatures = [];
    } else {
      let inferred: string | undefined;
      if (variable.type === undefined)
        inferred = await checker.typeToString(
          await checker.getTypeOfSymbol(aliased),
          variable,
          TypeFormatFlags.NoTruncation |
            TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
        );
      signatures = [
        withInferredType(
          fileText.slice(
            outerStatement(variable).getStart(),
            initializerEnd(variable),
          ),
          inferred,
          variable.type !== undefined,
        ),
      ];
    }
    table = typeTableQuery(includeTypeTable, file, name);
  } else {
    signatures = [cleanSignature(impl.getText())];
    table = typeTableQuery(includeTypeTable, file, name);
  }
  if (table) jobFor(jobs, table.file).queries.push(table.query);
  return {
    package: packageName,
    name,
    kind,
    description: firstProse(groups),
    signatures,
    seeTexts: textsFor(tags, ["see"]),
    exampleSpecs: textsFor(tags, ["exampleFile"]),
    returns: textsFor(tags, ["returns", "return"]),
    throws: textsFor(tags, ["throws", "throw"]),
    tags: storedTags(tags),
    group: singleGroup(textsFor(tags, ["group"])),
    source: relative(repoRoot, file).split("\\").join("/"),
    typeTable: table,
    parameterQueries,
    memberDescriptions: null,
  };
}

async function readStructMembers(
  variable: VariableDeclaration,
  checker: Checker,
  jobs: Map<string, FileJob>,
): Promise<{ pages: PageDraft[]; descriptions: Map<string, string> }> {
  const initializer = defined(
    nestedExpression(variable.initializer, [
      SyntaxKind.AsExpression,
      SyntaxKind.SatisfiesExpression,
      SyntaxKind.ParenthesizedExpression,
    ]),
    "struct initializer",
  );
  requireKind(
    initializer.kind,
    SyntaxKind.ObjectLiteralExpression,
    "struct initializer is not an object literal",
  );
  const pages: PageDraft[] = [];
  const descriptions = new Map<string, string>();
  const properties = (initializer as unknown as { properties: readonly Node[] })
    .properties;
  for (const property of properties) {
    requireKind(
      property.kind,
      SyntaxKind.PropertyAssignment,
      `unsupported struct property ${property.getText()}`,
    );
    const assignment = property as unknown as { name: Node; initializer: Node };
    const name = objectPropertyName(
      assignment.name.getText(),
      assignment.name.kind,
      SyntaxKind.Identifier,
    );
    requireKind(
      assignment.initializer.kind,
      SyntaxKind.Identifier,
      `struct.${name} is not an identifier`,
    );
    const located = defined(
      await checker.getSymbolAtLocation(assignment.initializer),
      `struct.${name}`,
    );
    const page = await readPage(
      `@defjs/core`,
      `struct.${name}`,
      located,
      [],
      checker,
      jobs,
      false,
    );
    page.kind = "function";
    page.signatures = page.signatures.map((signature) =>
      facadeSignature(signature, name),
    );
    descriptions.set(name, page.description);
    pages.push(page);
  }
  return { pages, descriptions };
}

function tableKey(file: string, name: string): string {
  return `${file}\0${name}`;
}

export async function assemblePages(
  drafts: readonly PageDraft[],
  docs: readonly WorkerDoc[],
): Promise<ApiReferenceEntry[]> {
  const tables = new Map<string, WorkerEntry[]>();
  for (const doc of docs) tables.set(tableKey(doc.file, doc.name), doc.entries);
  const identities = identityIndex(drafts);
  const entries: ApiReferenceEntry[] = [];
  for (const draft of drafts) {
    const parameterSets = draft.signatures.map((_signature, index) => {
      const query = draft.parameterQueries[index];
      if (!query || query.query === "")
        return zipParameters(query ? query.drafts : [], []);
      return zipParameters(
        query.drafts,
        defined(tables.get(tableKey(query.file, query.query)), query.query),
      );
    });
    const typeTable = draft.typeTable
      ? defined(
          tables.get(tableKey(draft.typeTable.file, draft.typeTable.query)),
          draft.typeTable.query,
        ).map((entry) => {
          const stored = storedEntry(entry);
          stored.description = memberDescription(
            stored.description,
            lookupDescription(draft.memberDescriptions, stored.name),
          );
          return stored;
        })
      : null;
    const exampleFiles = [];
    for (const spec of draft.exampleSpecs)
      exampleFiles.push(await loadExample(docRoot, spec));
    entries.push(
      referenceRecord({
        package: draft.package,
        name: draft.name,
        kind: draft.kind,
        slug: apiSlug(draft.package, draft.name, draft.kind),
        source: draft.source,
        group: draft.group,
        description: draft.description,
        signatures: draft.signatures,
        related: unique(
          draft.seeTexts.map((text) => resolveSee(text, identities)),
        ),
        exampleFiles,
        returns: draft.returns,
        throws: draft.throws,
        tags: draft.tags,
        typeTable: typeTable === null ? null : visibleMembers(typeTable),
        parameters: parameterSets[0] ?? [],
        overloads: zipOverloads(draft.signatures, parameterSets, draft.returns),
      }),
    );
  }
  expandBindingParameters(entries);
  entries.sort((left, right) =>
    compareApiIdentity(
      `${left.package}:${left.name}`,
      `${right.package}:${right.name}`,
    ),
  );
  validateReference(entries, identities);
  return entries;
}

/**
 * `type` and `interface` are already declarations. Other forms need `declare`.
 * `struct.enum` and `struct.null` are documented as `function enum` / `function null`.
 * Those names are reserved, so the parse uses a legal binding and checks the rest unchanged.
 */
export function ambientDeclaration(signature: string): string {
  const text = signature.trim();
  if (/^(?:type|interface)\b/.test(text)) return text;
  if (/^function enum\b/.test(text))
    return `declare ${text.replace(/^function enum\b/, "function enumMember")}`;
  if (/^function null\b/.test(text))
    return `declare ${text.replace(/^function null\b/, "function nullMember")}`;
  return `declare ${text}`;
}

/** Name a parse diagnostic by the entry that owns the temp file, when it matches. */
export function syntaxOffender(
  files: readonly string[],
  ids: readonly string[],
  diagnostic: { fileName?: string | undefined; text: string },
): string {
  const id = ids[files.indexOf(diagnostic.fileName ?? "")];
  return `${id ?? diagnostic.fileName ?? "signature"} (${diagnostic.text})`;
}

/**
 * Fail generation when a signature is not syntactically valid TypeScript.
 * One file per signature: a parse error cascades to the next statement in the same file.
 * Semantic diagnostics are ignored, so a signature may name a type this package does not export.
 */
export async function assertSignatureSyntax(
  entries: readonly {
    package: string;
    name: string;
    signatures: readonly string[];
  }[],
): Promise<void> {
  const pending = entries.flatMap((entry) =>
    entry.signatures.map((signature) => ({
      id: `${entry.package}:${entry.name}`,
      signature,
    })),
  );
  if (pending.length === 0) return;
  const api = new API();
  const directory = await mkdtemp(join(tmpdir(), "zen-signature-"));
  try {
    const files: string[] = [];
    await Promise.all(
      pending.map((item, index) => {
        const file = join(directory, `${index}.d.ts`);
        files[index] = file;
        return writeFile(file, `${ambientDeclaration(item.signature)}\n`);
      }),
    );
    const program = await api.createProgram(files, {
      noEmit: true,
      noLib: true,
      skipLibCheck: true,
      types: [],
    } as RawCompilerOptions);
    const diagnostics = await program.getSyntacticDiagnostics();
    const offenders = diagnostics.map((diagnostic) =>
      syntaxOffender(
        files,
        pending.map((item) => item.id),
        diagnostic,
      ),
    );
    if (offenders.length > 0)
      throw new Error(
        `syntactically invalid signature: ${offenders.join(", ")}`,
      );
  } finally {
    await api.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function extractApiData(): Promise<ApiReferenceEntry[]> {
  const entries = await loadApiEntries();
  await assertSignatureSyntax(entries);
  return entries;
}

async function loadApiEntries(): Promise<ApiReferenceEntry[]> {
  const api = new API();
  try {
    const program: Program = await api.createProgram(
      packages.map((pkg) => join(repoRoot, pkg.entry)),
      compilerOptions,
    );
    const checker = projectChecker(
      program as unknown as { project?: { checker?: Checker } },
    );
    const jobs = new Map<string, FileJob>();
    const drafts: PageDraft[] = [];
    for (const pkg of packages) {
      const source = defined(
        await program.getSourceFile(join(repoRoot, pkg.entry)),
        pkg.entry,
      );
      const moduleSymbol = defined(
        await checker.getSymbolAtLocation(source),
        pkg.name,
      );
      for (const exported of await checker.getExportsOfModule(moduleSymbol)) {
        const exportNodes = await resolveAll(exported);
        const page = await readPage(
          pkg.name,
          exported.name,
          exported,
          exportNodes,
          checker,
          jobs,
          true,
        );
        if (pkg.name === "@defjs/core" && exported.name === "struct") {
          const impl = implementationNode(
            await resolveAll(
              await resolveAlias(exported, SymbolFlags.Alias, (symbol) =>
                checker.getAliasedSymbol(symbol),
              ),
            ),
            SyntaxKind.ExportSpecifier,
            SyntaxKind.ExportAssignment,
          );
          const members = await readStructMembers(
            impl as VariableDeclaration,
            checker,
            jobs,
          );
          page.memberDescriptions = members.descriptions;
          drafts.push(page, ...members.pages);
        } else drafts.push(page);
      }
    }
    const tables = await requestTypeTables(
      workerSource,
      {
        tsconfigPath: join(docRoot, "tsconfig.json"),
        jobs: [...jobs.values()].map((job) => ({
          file: job.file,
          suffix: job.suffix.join("\n"),
          queries: job.queries,
        })),
      },
      docRoot,
    );
    return await assemblePages(drafts, tables.docs);
  } finally {
    await api.close();
  }
}

export function syntheticQuery(
  draftCount: number,
  build: () => string,
): string {
  if (draftCount > 0) return build();
  return "";
}

/** Object-shaped aliases keep a member table. Unions and conditionals do not. */
export function typeAliasHasMembers(node: {
  kind: number;
  type?: { kind: number; type?: { kind: number } | undefined } | undefined;
}): boolean {
  let current = node.type;
  while (current && current.kind === SyntaxKind.ParenthesizedType)
    current = current.type;
  if (!current) return false;
  return (
    current.kind === SyntaxKind.TypeLiteral ||
    current.kind === SyntaxKind.IntersectionType
  );
}

export function typeTableQuery(
  include: boolean,
  file: string,
  name: string,
): { file: string; query: string } | null {
  if (!include) return null;
  return { file, query: name };
}

export async function resolveAlias<T extends { flags: number }>(
  symbol: T,
  aliasFlag: number,
  resolve: (symbol: T) => Promise<T>,
): Promise<T> {
  if ((symbol.flags & aliasFlag) !== 0) return resolve(symbol);
  return symbol;
}

export function outputDirectory(
  directory: string | undefined,
  fallback: string,
): string {
  return directory ?? fallback;
}

export async function writeExtractedApi(
  entries: readonly ApiReferenceEntry[],
  directory?: string,
): Promise<void> {
  const target = outputDirectory(directory, join(docRoot, "app/data"));
  await Bun.write(join(target, "api-entries.json"), serializeCatalog(entries));
  await Bun.write(
    join(target, "api-reference.json"),
    serializeReference(entries),
  );
  await Bun.write(
    join(target, "api-summaries.json"),
    serializeSummaries(entries),
  );
}

/** Reference so the type-table entry shape stays tied to fumadocs-typescript. */
export function fumadocsEntry(entry: DocEntry): WorkerEntry {
  const stored: WorkerEntry = {
    name: entry.name,
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

/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) {
  const entries = await extractApiData();
  await writeExtractedApi(entries);
}
