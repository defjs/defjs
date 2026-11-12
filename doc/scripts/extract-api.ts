import { docRoot, joinPath, repoRoot } from "./paths";
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
import {
  SyntaxKind,
  isAsExpression,
  isFunctionDeclaration,
  isIdentifier,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isTypeAliasDeclaration,
  isVariableDeclaration,
} from "typescript/ast";
import type {
  ConstructorTypeNode,
  Expression,
  FunctionDeclaration,
  FunctionTypeNode,
  Node,
  VariableDeclaration,
} from "typescript/ast";
import { tableEntries, typeColumns } from "./type-tables";
import { loadExample } from "./api-examples";
import {
  catalogKind,
  defined,
  lookupDescription,
  expandBindingParameters,
  memberDescription,
  parameterRequired,
  preferredParameterType,
  requireNode,
  serializeCatalog,
  serializeReference,
  serializeSummaries,
  storedEntry,
  typeOnlyExport,
  visibleMembers,
} from "./api-model";
import type { ApiReferenceEntry, StoredEntry } from "./api-model";
import { apiSlug } from "./api-slug";
import {
  annotatedTypeText,
  cleanSignature,
  declaredParameterType,
  facadeSignature,
  initializerEnd,
  withInferredType,
} from "./api-signature";
import { firstProse, paramDescription, storedTags, textsFor } from "./api-tags";
import type { DocTag } from "./api-tags";
import {
  identityIndex,
  overviewGroups,
  resolveSee,
  singleGroup,
  validateReference,
} from "./api-validate";

const packages = [
  { name: "@defjs/core", entry: "packages/core/src/index.ts" },
  { name: "@defjs/core/xsrf", entry: "packages/core/src/xsrf/index.ts" },
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
  kind: SyntaxKind;
  isTypeOnly?: boolean | undefined;
  parent?:
    | {
        kind: SyntaxKind;
        parent?:
          { kind: SyntaxKind; isTypeOnly?: boolean | undefined } | undefined;
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

interface TypeShape {
  kind: SyntaxKind;
  type?: TypeShape | undefined;
}

function isCallableShape(
  node: TypeShape,
): node is FunctionTypeNode | ConstructorTypeNode {
  return (
    node.kind === SyntaxKind.FunctionType ||
    node.kind === SyntaxKind.ConstructorType
  );
}

export function functionTypeOf(
  node: TypeShape,
): FunctionTypeNode | ConstructorTypeNode | undefined {
  let current: TypeShape | undefined = node;
  while (current && current.kind === SyntaxKind.ParenthesizedType)
    current = current.type;
  if (!current) return undefined;
  if (isCallableShape(current)) return current;
  return undefined;
}

interface Context {
  program: Program;
  checker: Checker;
}

interface OverloadDraft {
  signature: string;
  parameters: StoredEntry[];
}

interface PageDraft {
  package: string;
  name: string;
  kind: ApiReferenceEntry["kind"];
  description: string;
  overloads: OverloadDraft[];
  seeTexts: string[];
  exampleSpecs: string[];
  returns: string[];
  throws: string[];
  tags: { name: string; text: string }[];
  group: string;
  source: string;
  typeTable: StoredEntry[] | null;
  memberDescriptions: Map<string, string> | null;
}

/** An exported symbol, followed through re-exports to its declarations. */
interface Resolved {
  symbol: Symbol;
  nodes: Node[];
  impl: Node;
  tags: readonly DocTag[];
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

async function resolveExport(
  checker: Checker,
  exported: Symbol,
): Promise<Resolved> {
  const symbol =
    (exported.flags & SymbolFlags.Alias) !== 0
      ? await checker.getAliasedSymbol(exported)
      : exported;
  const nodes = await resolveAll(symbol);
  return {
    symbol,
    nodes,
    impl: defined(
      nodes.find(
        (node) =>
          node.kind !== SyntaxKind.ExportSpecifier &&
          node.kind !== SyntaxKind.ExportAssignment,
      ),
      "implementation declaration",
    ),
    tags: await checker.getJsDocTagsOfSymbol(symbol),
  };
}

/** One row per parameter. The type is what the checker prints for the annotation, unless the source text says more. */
async function parameterRows(
  { checker }: Context,
  node: FunctionDeclaration | FunctionTypeNode | ConstructorTypeNode,
  tags: readonly DocTag[],
): Promise<StoredEntry[]> {
  const rows: StoredEntry[] = [];
  for (const param of node.parameters) {
    const rest = param.dotDotDotToken !== undefined;
    const name = rest ? `...${param.name.getText()}` : param.name.getText();
    const declared = declaredParameterType(
      annotatedTypeText(param.type),
      param.initializer?.getText(),
    );
    const generated = param.type
      ? await typeColumns(
          await checker.getTypeFromTypeNode(param.type),
          checker,
          param,
          false,
        )
      : { type: declared, simplifiedType: declared };
    const type = preferredParameterType(declared, generated.type);
    rows.push({
      name,
      description: paramDescription(tags, name),
      type,
      simplifiedType: type === generated.type ? generated.simplifiedType : type,
      required: parameterRequired({
        rest,
        optional: param.questionToken !== undefined,
        initialized: param.initializer !== undefined,
      }),
      deprecated: false,
      tags: [],
    });
  }
  return rows;
}

function unwrap(expression: Expression | undefined): Expression | undefined {
  let current = expression;
  while (
    current &&
    (isAsExpression(current) ||
      isSatisfiesExpression(current) ||
      isParenthesizedExpression(current))
  )
    current = current.expression;
  return current;
}

/** The declaration of a constant. An unannotated `as const` object has no useful signature; its members do. */
async function variableSignature(
  { checker }: Context,
  symbol: Symbol,
  variable: VariableDeclaration,
): Promise<string | undefined> {
  const annotated = variable.type !== undefined;
  if (
    !annotated &&
    unwrap(variable.initializer)?.kind === SyntaxKind.ObjectLiteralExpression
  )
    return undefined;
  const inferred = annotated
    ? undefined
    : await checker.typeToString(
        await checker.getTypeOfSymbol(symbol),
        variable,
        TypeFormatFlags.NoTruncation |
          TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      );
  return withInferredType(
    variable
      .getSourceFile()
      .text.slice(
        outerStatement(variable).getStart(),
        initializerEnd(variable),
      ),
    inferred,
    annotated,
  );
}

/** The signatures of a declaration with their parameters, and whether it lists members. */
async function declarationShape(
  context: Context,
  { symbol, nodes, impl, tags }: Resolved,
): Promise<{ overloads: OverloadDraft[]; table: boolean }> {
  if (isFunctionDeclaration(impl)) {
    const functions = nodes.filter(isFunctionDeclaration);
    const heads = functions.filter((node) => node.body === undefined);
    const overloads: OverloadDraft[] = [];
    for (const fn of heads.length > 0 ? heads : functions.slice(0, 1))
      overloads.push({
        signature: cleanSignature(
          fn.getSourceFile().text.slice(fn.getStart(), fn.body?.pos ?? fn.end),
        ),
        parameters: await parameterRows(context, fn, tags),
      });
    return { overloads, table: false };
  }
  if (isTypeAliasDeclaration(impl)) {
    const signature = cleanSignature(impl.getText());
    const callable = functionTypeOf(impl.type);
    if (callable)
      return {
        overloads: [
          {
            signature,
            parameters: await parameterRows(context, callable, tags),
          },
        ],
        table: false,
      };
    return {
      overloads: [{ signature, parameters: [] }],
      table: typeAliasHasMembers(impl),
    };
  }
  if (isVariableDeclaration(impl)) {
    const signature = await variableSignature(context, symbol, impl);
    return {
      overloads: signature === undefined ? [] : [{ signature, parameters: [] }],
      table: true,
    };
  }
  return {
    overloads: [{ signature: cleanSignature(impl.getText()), parameters: [] }],
    table: true,
  };
}

function pageDraft(
  packageName: string,
  name: string,
  kind: ApiReferenceEntry["kind"],
  { nodes, impl, tags }: Resolved,
  overloads: OverloadDraft[],
  typeTable: StoredEntry[] | null,
): PageDraft {
  const file = impl.getSourceFile().fileName;
  return {
    package: packageName,
    name,
    kind,
    description: firstProse(
      nodes.flatMap((node) => [outerStatement(node).jsDoc, node.jsDoc]),
    ),
    overloads,
    seeTexts: textsFor(tags, ["see"]),
    exampleSpecs: textsFor(tags, ["exampleFile"]),
    returns: textsFor(tags, ["returns", "return"]),
    throws: textsFor(tags, ["throws", "throw"]),
    tags: storedTags(tags),
    group: singleGroup(textsFor(tags, ["group"])),
    source: file.replace(repoRoot, "").split("\\").join("/"),
    typeTable,
    memberDescriptions: null,
  };
}

/** The page of one export of a package entry point. */
async function readPage(
  context: Context,
  packageName: string,
  exported: Symbol,
): Promise<{ page: PageDraft; resolved: Resolved }> {
  const resolved = await resolveExport(context.checker, exported);
  const { overloads, table } = await declarationShape(context, resolved);
  const kind = catalogKind({
    typeOnlyExport: typeOnlyExport(
      (await resolveAll(exported)).map((node) => specifierIsTypeOnly(node)),
    ),
    declarationKind: declarationCategory(resolved.impl.kind),
  });
  const typeTable = table
    ? await tableEntries(
        resolved.impl.getSourceFile().fileName,
        exported.name,
        context.program,
        context.checker,
        joinPath(repoRoot, "packages/"),
      )
    : null;
  return {
    page: pageDraft(
      packageName,
      exported.name,
      kind,
      resolved,
      overloads,
      typeTable,
    ),
    resolved,
  };
}

/** `struct.any`, `struct.string`, ...: the facade functions listed in the object literal of `struct`. */
async function readStructMembers(
  context: Context,
  variable: VariableDeclaration,
): Promise<{ pages: PageDraft[]; descriptions: Map<string, string> }> {
  const literal = requireNode(
    defined(unwrap(variable.initializer), "struct initializer"),
    isObjectLiteralExpression,
    "struct initializer is not an object literal",
  );
  const pages: PageDraft[] = [];
  const descriptions = new Map<string, string>();
  for (const property of literal.properties) {
    const assignment = requireNode(
      property,
      isPropertyAssignment,
      `unsupported struct property ${property.getText()}`,
    );
    const name = requireNode(
      assignment.name,
      isIdentifier,
      `unsupported struct property name: ${assignment.name.getText()}`,
    ).text;
    const located = defined(
      await context.checker.getSymbolAtLocation(
        requireNode(
          assignment.initializer,
          isIdentifier,
          `struct.${name} is not an identifier`,
        ),
      ),
      `struct.${name}`,
    );
    const resolved = await resolveExport(context.checker, located);
    const { overloads } = await declarationShape(context, resolved);
    const page = pageDraft(
      "@defjs/core",
      `struct.${name}`,
      "function",
      resolved,
      overloads.map((overload) => ({
        ...overload,
        signature: facadeSignature(overload.signature, name),
      })),
      null,
    );
    descriptions.set(name, page.description);
    pages.push(page);
  }
  return { pages, descriptions };
}

const packageNames: readonly string[] = packages.map((pkg) => pkg.name);
const groupNames: readonly string[] = overviewGroups;

/** The index order: package, then the overview group, then the name by code unit. */
function compareEntries(
  left: ApiReferenceEntry,
  right: ApiReferenceEntry,
): number {
  return (
    packageNames.indexOf(left.package) - packageNames.indexOf(right.package) ||
    groupNames.indexOf(left.group) - groupNames.indexOf(right.group) ||
    Number(left.name > right.name) - Number(left.name < right.name)
  );
}

export async function assemblePages(
  drafts: readonly PageDraft[],
): Promise<ApiReferenceEntry[]> {
  const identities = identityIndex(drafts);
  const entries: ApiReferenceEntry[] = [];
  for (const draft of drafts) {
    const typeTable = draft.typeTable?.map((row) =>
      storedEntry({
        ...row,
        description: memberDescription(
          row.description,
          lookupDescription(draft.memberDescriptions, row.name),
        ),
      }),
    );
    const exampleFiles = [];
    for (const spec of draft.exampleSpecs)
      exampleFiles.push(await loadExample(docRoot, spec));
    entries.push({
      package: draft.package,
      name: draft.name,
      kind: draft.kind,
      slug: apiSlug(draft.package, draft.name, draft.kind),
      source: draft.source,
      group: draft.group,
      description: draft.description,
      signatures: draft.overloads.map((overload) => overload.signature),
      related: [
        ...new Set(draft.seeTexts.map((text) => resolveSee(text, identities))),
      ],
      exampleFiles,
      returns: draft.returns,
      throws: draft.throws,
      tags: draft.tags,
      typeTable: typeTable ? visibleMembers(typeTable) : null,
      parameters: draft.overloads[0]?.parameters ?? [],
      overloads: draft.overloads.map((overload) => ({
        signature: overload.signature,
        parameters: overload.parameters,
        returns: [...draft.returns],
      })),
    });
  }
  expandBindingParameters(entries);
  entries.sort(compareEntries);
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
    const program = await api.createProgram(
      packages.map((pkg) => joinPath(repoRoot, pkg.entry)),
      compilerOptions,
    );
    const context = { program, checker: program.getProject().checker };
    const drafts: PageDraft[] = [];
    for (const pkg of packages) {
      const source = defined(
        await program.getSourceFile(joinPath(repoRoot, pkg.entry)),
        pkg.entry,
      );
      const moduleSymbol = defined(
        await context.checker.getSymbolAtLocation(source),
        pkg.name,
      );
      for (const exported of await context.checker.getExportsOfModule(
        moduleSymbol,
      )) {
        const { page, resolved } = await readPage(context, pkg.name, exported);
        drafts.push(page);
        if (pkg.name === "@defjs/core" && exported.name === "struct") {
          const members = await readStructMembers(
            context,
            requireNode(
              resolved.impl,
              isVariableDeclaration,
              "struct is not a variable declaration",
            ),
          );
          page.memberDescriptions = members.descriptions;
          drafts.push(...members.pages);
        }
      }
    }
    return await assemblePages(drafts);
  } finally {
    await api.close();
  }
}

/** Object-shaped aliases keep a member table. Unions and conditionals do not. */
export function typeAliasHasMembers(node: {
  kind: SyntaxKind;
  type?:
    { kind: SyntaxKind; type?: { kind: SyntaxKind } | undefined } | undefined;
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

export async function writeExtractedApi(
  entries: readonly ApiReferenceEntry[],
  directory: string,
): Promise<void> {
  await Bun.write(
    joinPath(directory, "api-entries.json"),
    serializeCatalog(entries),
  );
  await Bun.write(
    joinPath(directory, "api-reference.json"),
    serializeReference(entries),
  );
  await Bun.write(
    joinPath(directory, "api-summaries.json"),
    serializeSummaries(entries),
  );
}

/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) {
  const entries = await extractApiData();
  await writeExtractedApi(entries, joinPath(docRoot, "app/data"));
}
