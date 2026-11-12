import {
  ObjectFlags,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
  TypeFormatFlags,
} from "typescript/async";
import type { Checker, Program, Symbol, Type } from "typescript/async";
import {
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
} from "typescript/ast";
import type {
  MethodDeclaration,
  MethodSignatureDeclaration,
  Node,
  PropertyAssignment,
  PropertyDeclaration,
  PropertySignatureDeclaration,
} from "typescript/ast";
import { defined, requireNode, type StoredEntry } from "./api-model";

const PRINT_FLAGS =
  TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  TypeFormatFlags.NoTruncation;

/** Port of fumadocs-typescript's coarse type name: alias, union, array, object, or printed type. */
async function simpleForm(
  type: Type,
  checker: Checker,
  location: Node,
  noUndefined = false,
): Promise<string> {
  if ((type.flags & TypeFlags.Undefined) !== 0 && noUndefined) return "";
  const alias = await type.getAliasSymbol();
  // An interface reference is not a type alias; some async-checker builds expose its symbol here.
  /* istanbul ignore if -- the async checker exposes interface aliases only on some platforms */
  if (alias && (alias.flags & SymbolFlags.Interface) === 0) {
    const args = await type.getAliasTypeArguments();
    if (args.length === 0) return alias.name;
    return `${alias.name}<${(
      await Promise.all(args.map((arg) => simpleForm(arg, checker, location)))
    ).join(", ")}>`;
  }
  if (type.isUnionType()) {
    if (noUndefined) {
      const members = (await type.getTypes()).filter(
        (member) => (member.flags & TypeFlags.Undefined) === 0,
      );
      const [only] = members;
      if (members.length === 1 && only) {
        return simpleForm(only, checker, location);
      }
    }
    return "union";
  }
  if (type.isIntersectionType()) {
    const parts: string[] = [];
    for (const member of await type.getTypes()) {
      const text = await simpleForm(member, checker, location);
      /* istanbul ignore else -- a top-level intersection member is never `never` */
      if (text.length > 0 && text !== "never") parts.unshift(text);
    }
    return [...new Set(parts)].join(" & ");
  }
  if (type.isObjectType()) {
    if (await checker.isTupleType(type)) return "tuple";
    if (await checker.isArrayType(type)) return "array";
    if (
      (await checker.getSignaturesOfType(type, SignatureKind.Call)).length > 0
    )
      return "function";
    return "object";
  }
  if (
    (type.flags &
      (TypeFlags.Primitive | TypeFlags.AnyOrUnknown | TypeFlags.Never)) ===
      0 &&
    (await checker.getSignaturesOfType(type, SignatureKind.Call)).length > 0
  )
    return "function";
  return checker.typeToString(type, location, PRINT_FLAGS);
}

function isPrivateName(name: string): boolean {
  return name.startsWith("#") || name.startsWith("__#");
}

/** The coarse and the printed type of a documented position, as the member and parameter tables show them. */
export async function typeColumns(
  type: Type,
  checker: Checker,
  location: Node,
  optional: boolean,
): Promise<{ type: string; simplifiedType: string }> {
  return {
    type: await checker.typeToString(type, location, PRINT_FLAGS),
    simplifiedType: await simpleForm(type, checker, location, optional),
  };
}

/** Declaration kinds that a documented member can have in the packages. */
function isNamedMember(
  node: Node,
): node is
  | PropertyAssignment
  | PropertySignatureDeclaration
  | PropertyDeclaration
  | MethodSignatureDeclaration
  | MethodDeclaration {
  return (
    isPropertyAssignment(node) ||
    isPropertySignatureDeclaration(node) ||
    isPropertyDeclaration(node) ||
    isMethodSignatureDeclaration(node) ||
    isMethodDeclaration(node)
  );
}

async function docEntry(
  symbol: Symbol,
  owner: Type,
  location: Node,
  checker: Checker,
  packagesRoot: string,
): Promise<StoredEntry | undefined> {
  const declaration = defined(
    await (symbol.valueDeclaration ?? symbol.declarations[0])?.resolve(),
    `${symbol.name} declaration`,
  );
  const file = declaration.getSourceFile().fileName.replaceAll("\\", "/");
  if (!file.startsWith(packagesRoot) || file.includes("/node_modules/"))
    return undefined;
  if (
    owner.isObjectType() &&
    (owner.objectFlags & ObjectFlags.Class) !== 0 &&
    isPrivateName(symbol.name)
  ) {
    return undefined;
  }
  const tags: { name: string; text: string }[] = [];
  for (const tag of await checker.getJsDocTagsOfSymbol(symbol)) {
    if (tag.name === "internal") return undefined;
    tags.push({ name: tag.name, text: tag.text ?? "" });
  }
  const optional = (symbol.flags & SymbolFlags.Optional) !== 0;
  const entry: StoredEntry = {
    name: requireNode(
      declaration,
      isNamedMember,
      `unsupported member declaration of ${symbol.name}`,
    ).name.getText(),
    description: await checker.getDocumentationCommentOfSymbol(symbol),
    ...(await typeColumns(
      await checker.getTypeOfSymbolAtLocation(symbol, location),
      checker,
      location,
      optional,
    )),
    required: !optional,
    deprecated: false,
    tags,
  };
  for (const tag of tags) {
    switch (tag.name) {
      case "fumadocsType": {
        const overridden = /`(?<name>.+)`$/.exec(tag.text)?.groups?.["name"];
        if (overridden) entry.type = overridden;
        break;
      }
      case "remarks": {
        const overridden = /^`(?<name>.+)`/.exec(tag.text)?.groups?.["name"];
        if (overridden) entry.simplifiedType = overridden;
        break;
      }
      case "fumadocsHref": {
        const href = tag.text.trim();
        if (href.length > 0) entry.typeHref = href;
        break;
      }
      case "deprecated":
        entry.deprecated = true;
        break;
    }
  }
  return entry;
}

/**
 * Mirrors fumadocs-typescript's per-export entry generation for one file/name pair.
 * Only members declared under `packagesRoot` are listed.
 */
export async function tableEntries(
  file: string,
  name: string,
  program: Program,
  checker: Checker,
  packagesRoot: string,
): Promise<StoredEntry[]> {
  const sourceFile = defined(await program.getSourceFile(file), file);
  const moduleSymbol = defined(
    await checker.getSymbolAtLocation(sourceFile),
    name,
  );
  for (const exported of await checker.getExportsOfModule(moduleSymbol)) {
    if (exported.name !== name) continue;
    const symbol =
      (exported.flags & SymbolFlags.Alias) !== 0
        ? await checker.getAliasedSymbol(exported)
        : exported;
    const declaration = defined(
      await symbol.declarations[0]?.resolve(),
      `${name} declaration`,
    );
    const type = await checker.getTypeAtLocation(declaration);
    const entries: StoredEntry[] = [];
    for (const property of await checker.getPropertiesOfType(type)) {
      const entry = await docEntry(
        property,
        type,
        declaration,
        checker,
        packagesRoot,
      );
      if (entry) entries.push(entry);
    }
    return entries;
  }
  throw new Error(`no export ${name} in ${file}`);
}
