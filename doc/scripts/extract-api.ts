import { joinPath } from "./paths";
import { removeDirectory, tempDirectory } from "./tmp";
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
import { compareApiIdentity } from "./api-order";
import { tableEntries } from "./type-tables";
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

const repoRoot = Bun.fileURLToPath(new URL("../..", import.meta.url));
const docRoot = Bun.fileURLToPath(new URL("..", import.meta.url));
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
  lib: ["ESNext", "DOM", "DOM.Iterable"],
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  types: [],
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  baseUrl: repoRoot,
  paths: {
    "@defjs/core": [joinPath(repoRoot, "packages/core/src/index.ts")],
    "@defjs/react": [joinPath(repoRoot, "packages/react/src/index.ts")],
    "@defjs/vue": [joinPath(repoRoot, "packages/vue/src/index.ts")],
    "@defjs/opentelemetry-server": [
      joinPath(repoRoot, "packages/opentelemetry-server/src/index.ts"),
    ],
  },
} satisfies RawCompilerOptions;

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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
  if (node.kind !== SyntaxKind.ExportSpecifier) return false;
  if (node.isTypeOnly) return true;
  const named = node.parent;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
  if (!named || named.kind !== SyntaxKind.NamedExports) return false;
  const decl = named.parent;
  return Boolean(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
    decl && decl.kind === SyntaxKind.ExportDeclaration && decl.isTypeOnly,
  );
}

export function functionTypeOf(node: {
  kind: number;
  type?: { kind: number; type?: { kind: number } | undefined } | undefined;
}): { kind: number } | undefined {
  let current:
    { kind: number; type?: { kind: number } | undefined } | undefined = node;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
  while (current && current.kind === SyntaxKind.ParenthesizedType)
    current = current.type;
  if (!current) return undefined;
  if (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
    current.kind === SyntaxKind.FunctionType ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
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
  for (const param of node.parameters) {
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
    lines.push(
      `  /** ${description} */\n  p${drafts.length - 1}: ${typeText};`,
    );
  }
  return {
    drafts,
    block: lines.join("\n"),
    clause: typeParameterClause(fileText, node.typeParameters),
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
async function callablePages(
  nodes: readonly Node[],
  tags: readonly DocTag[],
  jobs: Map<string, FileJob>,
): Promise<{ signatures: string[]; parameterQueries: ParameterQuery[] }> {
  const selected = overloadNodes(nodes, SyntaxKind.FunctionDeclaration);
  const signatures: string[] = [];
  const parameterQueries: ParameterQuery[] = [];
  for (const node of selected) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the existing function-kind selection controls the node without changing overload selection or validation
    const fn = node as FunctionDeclaration;
    const fileText = fn.getSourceFile().text;
    const signature = cleanSignature(
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
  const tags = await checker.getJsDocTagsOfSymbol(aliased);
  const kind = catalogKind({
    typeOnlyExport: typeOnlyExport(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve type-only flag inspection for every export node, including assignments
      exportNodes.map((node) => specifierIsTypeOnly(node as ExportSpecifier)),
    ),
    declarationKind: declarationCategory(impl.kind),
  });
  const groups = nodes.flatMap((node) => [
    outerStatement(node).jsDoc,
    node.jsDoc,
  ]);
  let signatures: string[];
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the existing type-alias kind branch controls the original property read without a new guard
    const callable = functionTypeOf((impl as unknown as { type: Node }).type);
    if (callable) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve handling of both callable syntax kinds without changing the helper input contract
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
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-type-assertion -- INTENT: preserve original type-alias member queries without narrowing the accepted helper input
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the existing variable-kind branch controls the node without adding validation
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
    source: file.replace(repoRoot, "").split("\\").join("/"),
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
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original initializer-kind check and direct property access ordering
  const properties = (initializer as unknown as { properties: readonly Node[] })
    .properties;
  for (const property of properties) {
    requireKind(
      property.kind,
      SyntaxKind.PropertyAssignment,
      `unsupported struct property ${property.getText()}`,
    );
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the existing property-kind check and original name/initializer reads
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
  tables: ReadonlyMap<string, readonly WorkerEntry[]>,
): Promise<ApiReferenceEntry[]> {
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
  const directory = tempDirectory("zen-signature");
  try {
    const files: string[] = [];
    await Promise.all(
      pending.map((item, index) => {
        const file = joinPath(directory, `${index}.d.ts`);
        files[index] = file;
        return Bun.write(file, `${ambientDeclaration(item.signature)}\n`);
      }),
    );
    const program = await api.createProgram(files, {
      noEmit: true,
      noLib: true,
      skipLibCheck: true,
      types: [],
    });
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
    removeDirectory(directory);
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
      packages.map((pkg) => joinPath(repoRoot, pkg.entry)),
      compilerOptions,
    );
    const checker = projectChecker(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: read the existing project field without invoking getProject or changing lookup side effects
      program as unknown as { project?: { checker?: Checker } },
    );
    const jobs = new Map<string, FileJob>();
    const drafts: PageDraft[] = [];
    for (const pkg of packages) {
      const source = defined(
        await program.getSourceFile(joinPath(repoRoot, pkg.entry)),
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
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve original struct extraction and its errors without a new early declaration-kind error
            impl as VariableDeclaration,
            checker,
            jobs,
          );
          page.memberDescriptions = members.descriptions;
          drafts.push(page, ...members.pages);
        } else drafts.push(page);
      }
    }
    const tables = new Map<string, readonly WorkerEntry[]>();
    const roots: string[] = [];
    const tempFiles: string[] = [];
    const fileForJob = new Map<string, string>();
    try {
      for (const [index, job] of [...jobs.values()].entries()) {
        if (job.suffix.length === 0) {
          roots.push(job.file);
          fileForJob.set(job.file, job.file);
          continue;
        }
        const source = await Bun.file(job.file).text();
        const temp = `${job.file}.__api_gen_${index}.ts`;
        await Bun.write(temp, `${source}\n${job.suffix.join("\n")}`);
        roots.push(temp);
        tempFiles.push(temp);
        fileForJob.set(job.file, temp);
      }
      const tableProgram = await api.createProgram(roots, compilerOptions);
      const tableChecker = projectChecker(
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: read the existing project field without invoking getProject or changing lookup side effects
        tableProgram as unknown as { project?: { checker?: Checker } },
      );
      for (const job of jobs.values()) {
        const root = defined(fileForJob.get(job.file), job.file);
        for (const query of job.queries) {
          tables.set(
            tableKey(job.file, query),
            await tableEntries(root, query, tableProgram, tableChecker),
          );
        }
      }
    } finally {
      for (const temp of tempFiles) {
        await Bun.file(temp).delete();
      }
    }
    return await assemblePages(drafts, tables);
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
  while (current && current.kind === SyntaxKind.ParenthesizedType)
    current = current.type;
  if (!current) return false;
  return (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
    current.kind === SyntaxKind.TypeLiteral ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- INTENT: preserve numeric syntax-kind inputs and the original extraction and async error behavior
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
  const target = outputDirectory(directory, joinPath(docRoot, "app/data"));
  await Bun.write(
    joinPath(target, "api-entries.json"),
    serializeCatalog(entries),
  );
  await Bun.write(
    joinPath(target, "api-reference.json"),
    serializeReference(entries),
  );
  await Bun.write(
    joinPath(target, "api-summaries.json"),
    serializeSummaries(entries),
  );
}

/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) {
  const entries = await extractApiData();
  await writeExtractedApi(entries);
}
