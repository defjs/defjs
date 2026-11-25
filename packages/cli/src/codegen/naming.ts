import { camelCase, kebabCase, pascalCase } from "es-toolkit/string";

const RESERVED_WORDS = new Set([
  "abstract",
  "arguments",
  "await",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "final",
  "finally",
  "float",
  "for",
  "function",
  "goto",
  "if",
  "implements",
  "import",
  "in",
  "Infinity",
  "instanceof",
  "int",
  "interface",
  "let",
  "long",
  "NaN",
  "native",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "volatile",
  "while",
  "with",
  "yield",
]);

function asciiOnly(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]+/g, " ");
}

export function escapeIdentifier(name: string, fallback: string): string {
  const base = name === "" ? fallback : name;
  const prefixed = /^[0-9]/.test(base) ? `_${base}` : base;
  return RESERVED_WORDS.has(prefixed) ? `${prefixed}_` : prefixed;
}

export function toCamelCase(raw: string, fallback: string): string {
  return escapeIdentifier(camelCase(asciiOnly(raw)), fallback);
}

export function toPascalCase(raw: string, fallback: string): string {
  return escapeIdentifier(pascalCase(asciiOnly(raw)), fallback);
}

export function toKebabCase(raw: string, fallback: string): string {
  const result = kebabCase(asciiOnly(raw));
  return result === "" ? fallback : result;
}

export function createUniqueNamer(
  initial: Iterable<string> = [],
): (base: string) => string {
  const used = new Set<string>(initial);
  return (base: string) => {
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let counter = 2;
    while (used.has(`${base}${counter}`)) {
      counter += 1;
    }
    const candidate = `${base}${counter}`;
    used.add(candidate);
    return candidate;
  };
}
