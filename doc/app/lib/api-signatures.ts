import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";

export interface SignatureEntry {
  name: string;
  signatures: readonly string[];
}

export type SignatureCatalog = ReadonlyMap<string, readonly string[]>;

export interface SignatureFile {
  path?: string;
  history?: readonly string[];
}

/** The file and mdast nodes that remark passes to plugins and that `replaceSource` records an edit against. */
export type SignatureSourceFile = Parameters<typeof replaceSource>[0];
type SourceNode = Parameters<typeof replaceSource>[1];
export type SignatureContent = Exclude<SourceNode, { type: "root" }>;
export type SignatureRoot = Extract<SourceNode, { type: "root" }>;
type SignatureElement = Extract<
  SignatureContent,
  { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }
>;

/** Any mdast node; a signature tag among its children is replaced in place, as in an mdast `Parent`. */
export interface SignatureTree {
  type: string;
  children?: SignatureContent[];
}

interface CatalogCache {
  path: string;
  mtimeMs: number;
  catalog: Promise<SignatureCatalog>;
}

let catalogCache: CatalogCache | undefined;

function isSignatureEntry(value: unknown): value is SignatureEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "signatures" in value &&
    Array.isArray(value.signatures) &&
    value.signatures.every((signature) => typeof signature === "string")
  );
}

/** Names are unique. An empty signature list cannot be rendered. */
export function signatureCatalog(
  entries: readonly SignatureEntry[],
): SignatureCatalog {
  const catalog = new Map<string, readonly string[]>();
  for (const entry of entries) {
    if (catalog.has(entry.name))
      throw new Error(`Ambiguous API signature "${entry.name}"`);
    catalog.set(entry.name, entry.signatures);
  }
  return catalog;
}

export function apiReferenceFile(cwd = `${import.meta.dirname}/../..`): string {
  const candidates = [
    `${cwd}/app/data/api-reference.json`,
    `${cwd}/doc/app/data/api-reference.json`,
  ];
  for (const candidate of candidates)
    if (Bun.file(candidate).size > 0) return candidate;
  throw new Error(`Cannot find api-reference.json from ${cwd}`);
}

async function loadSignatureCatalog(path: string): Promise<SignatureCatalog> {
  let parsed: unknown;
  try {
    parsed = await Bun.file(path).json();
  } catch (error) {
    throw new Error(`Cannot read API signatures from ${path}`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed))
    throw new Error(`API reference is not a list: ${path}`);
  if (!parsed.every(isSignatureEntry))
    throw new Error(`API reference has a malformed entry: ${path}`);
  return signatureCatalog(parsed);
}

/**
 * Reads the catalog from disk so a rebuilt page sees a changed reference file.
 * The read is cached by modification time, so pages compiled together share it.
 */
export function readSignatureCatalog(path: string): Promise<SignatureCatalog> {
  const mtimeMs = Bun.file(path).lastModified;
  if (catalogCache?.path === path && catalogCache.mtimeMs === mtimeMs)
    return catalogCache.catalog;
  const catalog = loadSignatureCatalog(path);
  catalogCache = { path, mtimeMs, catalog };
  return catalog;
}

export function signatureFile(file: SignatureFile): string {
  return file.path ?? file.history?.at(-1) ?? "unknown file";
}

/** One entry's overloads stay on consecutive lines. Names are separated by a blank line. */
export function signatureText(
  catalog: SignatureCatalog,
  attribute: string,
  file: string,
): string {
  const names = attribute
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0)
    throw new Error(`Missing API signature name in ${file}`);
  return names
    .map((name) => {
      const signatures = catalog.get(name);
      if (!signatures)
        throw new Error(`Unknown API signature "${name}" in ${file}`);
      if (signatures.length === 0)
        throw new Error(`API signature "${name}" has no text in ${file}`);
      return signatures.map((signature) => signature.trim()).join("\n");
    })
    .join("\n\n");
}

function signatureAttribute(node: SignatureElement, file: string): string {
  const attribute = node.attributes.find(
    (item) => item.type === "mdxJsxAttribute" && item.name === "name",
  );
  if (!attribute || typeof attribute.value !== "string")
    throw new Error(`API signature name in ${file} must be a string`);
  return attribute.value;
}

/** `.md` pages parse the tag as raw HTML. `.mdx` pages parse it as JSX. */
function signatureName(
  node: SignatureContent,
  file: string,
): string | undefined {
  if (node.type === "html") {
    const text = node.value.trim();
    if (!text.startsWith("<ApiSignature")) return undefined;
    const name = /\bname="([^"]*)"/.exec(text)?.[1];
    if (name === undefined)
      throw new Error(`API signature name in ${file} must be a string`);
    return name;
  }
  if (
    (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") ||
    node.name !== "ApiSignature"
  )
    return undefined;
  return signatureAttribute(node, file);
}

export function replaceApiSignatures(
  tree: SignatureTree,
  file: SignatureSourceFile,
  catalog: SignatureCatalog,
): void {
  const children = tree.children;
  if (!children) return;
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!child) continue;
    const attribute = signatureName(child, signatureFile(file));
    if (attribute === undefined) {
      replaceApiSignatures(child, file, catalog);
      continue;
    }
    const value = signatureText(catalog, attribute, signatureFile(file));
    // Processed Markdown is sliced from the authored source, so the fence has to be recorded on the original node.
    replaceSource(file, child, "```ts\n" + value + "\n```");
    children[index] = { type: "code", lang: "ts", value };
  }
}

/** Attacher: unified calls this once, then the returned function for every page. */
export function remarkApiSignatures(): (
  tree: SignatureRoot,
  file: SignatureSourceFile,
) => Promise<void> {
  return async (tree, file) => {
    replaceApiSignatures(
      tree,
      file,
      await readSignatureCatalog(apiReferenceFile()),
    );
  };
}

const declaration =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/;

/** Declaration names inside fences that are public catalog entries. */
export function handCopiedGeneratedNames(
  markdown: string,
  catalog: ReadonlySet<string>,
): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  let fence: string | undefined;
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (!fence) continue;
    const name = declaration.exec(line)?.[1];
    if (name && catalog.has(name)) found.push({ name, line: index + 1 });
  }
  return found;
}
