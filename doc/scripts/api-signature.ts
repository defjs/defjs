export function stripInnerDocs(text: string): string {
  return text
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanSignature(text: string): string {
  let value = text.replace(/\r\n/g, "\n").trim();
  while (/^(export|declare|async)\s+/.test(value))
    value = value.replace(/^(export|declare|async)\s+/, "");
  value = omitInternalMembers(value);
  value = stripInnerDocs(value).trim();
  value = presentClass(value);
  value = readableBinding(value);
  value = value.replace(/\{\s*$/, "").trim();
  value = hideDefaultExpressions(value);
  value = value.replace(/\s*=\s*$/, "").trim();
  value = collapseMemberGaps(value);
  value = value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return finishSignature(value);
}

/**
 * A class or interface body ends with `}`. A header with no body, and every
 * function, alias, and constant, ends with one `;`.
 */
export function finishSignature(value: string): string {
  const trimmed = value.replace(/;+\s*$/, "").trim();
  if (/^(?:interface|class)\b/.test(trimmed) && /\}\s*$/.test(trimmed))
    return trimmed;
  return `${trimmed};`;
}

/** Drop a member whose own doc comment is `@internal`, including that comment. */
export function omitInternalMembers(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    if (!/^\s*\/\*\*/.test(line)) {
      kept.push(line);
      index += 1;
      continue;
    }
    const start = index;
    let comment = "";
    let trailing = "";
    while (index < lines.length) {
      const current = lines[index] as string;
      const close = current.indexOf("*/");
      if (close === -1) {
        comment += `${current}\n`;
        index += 1;
        continue;
      }
      comment += `${current.slice(0, close + 2)}\n`;
      trailing = current.slice(close + 2);
      index += 1;
      break;
    }
    if (!/@internal\b/i.test(comment)) {
      for (let cursor = start; cursor < index; cursor += 1)
        kept.push(lines[cursor] as string);
      continue;
    }
    const pending = trailing.trim()
      ? [trailing, ...lines.slice(index)]
      : lines.slice(index);
    const consumed = skipMember(pending, 0);
    index += trailing.trim() ? Math.max(0, consumed - 1) : consumed;
  }
  return kept.join("\n");
}

function skipMember(lines: readonly string[], start: number): number {
  let depth = 0;
  let seen = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] as string;
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        seen = true;
      } else if (char === "}") {
        depth -= 1;
        if (seen && depth <= 0) return index + 1;
      }
    }
    if (line.includes(";") && depth === 0) return index + 1;
  }
  return lines.length;
}

/**
 * `name: Type = expr` and `name = ""` are not useful in a public signature.
 * `=` inside `<...>` is a type-parameter default and stays.
 */
export function hideDefaultExpressions(text: string): string {
  let result = "";
  let angle = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "<" && text[index + 1] !== "=") {
      angle += 1;
      result += char;
      continue;
    }
    if (char === ">" && text[index - 1] !== "=" && angle > 0) {
      angle -= 1;
      result += char;
      continue;
    }
    if (char !== "=" || angle > 0 || !isValueDefault(text, index)) {
      result += char;
      continue;
    }
    const exprEnd = endOfDefault(text, index + 1);
    const expr = text.slice(index + 1, exprEnd).trim();
    if (!expr) {
      result += "=";
      continue;
    }
    const typed = typedDefault(result);
    const bare = /(\b\w+)\s*$/.exec(result);
    const literal = literalType(expr);
    if (typed) {
      result = `${typed.prefix}${typed.name}?: ${typed.type}`;
      index = exprEnd - 1;
      continue;
    }
    if (bare?.[1] && literal) {
      const before = result.slice(0, result.length - bare[0].length);
      if (!/\bextends\s*$/.test(before)) {
        result = `${before}${bare[1]}?: ${literal}`;
        index = exprEnd - 1;
        continue;
      }
    }
    result += "=";
  }
  return result;
}

/** The parameter immediately before `=`, when it has an annotation. */
function typedDefault(
  head: string,
): { name: string; type: string; prefix: string } | undefined {
  let depth = 0;
  for (let index = head.length - 1; index >= 0; index -= 1) {
    const char = head[index];
    if (char === ">" || char === ")" || char === "]" || char === "}") {
      depth += 1;
      continue;
    }
    if (char === "<" || char === "(" || char === "[" || char === "{") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (char === ",") return undefined;
    if (char !== ":") continue;
    const type = head.slice(index + 1).trim();
    const before = head.slice(0, index);
    const name = /(\b\w+)\??\s*$/.exec(before);
    if (!name?.[1] || !type) return undefined;
    return {
      name: name[1],
      type,
      prefix: before.slice(0, before.length - name[0].length),
    };
  }
  return undefined;
}

function isValueDefault(text: string, index: number): boolean {
  const previous = text[index - 1];
  const next = text[index + 1];
  if (next === "=" || next === ">") return false;
  if (
    previous === "=" ||
    previous === "!" ||
    previous === "<" ||
    previous === ">"
  )
    return false;
  return true;
}

function endOfDefault(text: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\" && quote !== "`") {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return index;
      depth -= 1;
    } else if ((char === "," || char === "\n") && depth === 0) return index;
  }
  return text.length;
}

function literalType(expr: string): string | undefined {
  if (/^(?:"[^"]*"|'[^']*'|`[^`]*`)$/.test(expr)) return "string";
  if (/^-?\d+(?:\.\d+)?$/.test(expr)) return "number";
  if (expr === "true" || expr === "false") return "boolean";
  return undefined;
}

export function collapseMemberGaps(text: string): string {
  return text.replace(/\n(?:[ \t]*\n)+/g, "\n");
}

export function declaredParameterType(
  annotated: string | undefined,
  initializer: string | undefined,
): string {
  if (annotated?.trim()) return annotated.trim();
  const value = initializer?.trim() ?? "";
  if (/^(?:"[^"]*"|'[^']*'|`[^`]*`)$/.test(value)) return "string";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return "number";
  if (value === "true" || value === "false") return "boolean";
  return "unknown";
}

/** Facade pages say `function any`, not `function createAnyStruct`. */
export function facadeSignature(signature: string, member: string): string {
  return signature.replace(/^function\s+[A-Za-z0-9_]+/, `function ${member}`);
}

/** An unannotated `as const` object has no useful signature; its members do. */
export function suppressObjectSignature(
  annotated: boolean,
  initializer: { kind: number } | undefined,
  objectLiteralKind: number,
): boolean {
  if (annotated) return false;
  if (!initializer) return false;
  return initializer.kind === objectLiteralKind;
}

/** Append a short inferred type only when the declaration has no annotation. */
export function withInferredType(
  signature: string,
  inferred: string | undefined,
  annotated: boolean,
): string {
  const cleaned = cleanSignature(signature);
  if (annotated) return cleaned;
  const suffix = inferredTypeSuffix(inferred);
  if (!suffix) return cleaned;
  return `${cleaned.slice(0, -1)}${suffix};`;
}

export function typeParameterClause(
  fileText: string,
  params: { pos: number; end: number } | undefined,
): string {
  if (!params) return "";
  const text = fileText.slice(params.pos, params.end);
  const start = text.indexOf("<");
  const end = text.lastIndexOf(">");
  if (start < 0 || end <= start) return "";
  return text.slice(start + 1, end).trim();
}

export function cutEnd(
  mode: "members" | "body" | "node",
  marker: number | undefined,
  nodeEnd: number,
): number {
  if (mode !== "node" && marker !== undefined) return marker;
  return nodeEnd;
}

export function initializerEnd(node: {
  initializer?: { getStart(): number } | undefined;
  end: number;
}): number {
  return node.initializer ? node.initializer.getStart() : node.end;
}

export function annotatedTypeText(
  type: { getText(): string } | undefined,
): string | undefined {
  if (!type) return undefined;
  return type.getText();
}

/** `{ client, children }: ClientProviderProps` is the implementation pattern, not the declaration. */
export function parameterName(typeName: string): string {
  if (typeName.endsWith("Props")) return "props";
  return `${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}`;
}

export function readableBinding(signature: string): string {
  const match =
    /^([\s\S]*?\bfunction\s+[A-Za-z0-9_]+\s*(?:<[^;]*>)?\s*)\(\s*\{[^{}]*\}\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/.exec(
      signature,
    );
  const head = match?.[1];
  const typeName = match?.[2];
  if (!head || !typeName) return signature;
  const flatHead = head.replace(/\s+/g, " ");
  const rest = signature
    .slice(match[0].length)
    .replace(/\s+/g, " ")
    .replace(/< /g, "<")
    .replace(/ >/g, ">");
  return `${flatHead}(${parameterName(typeName)}: ${typeName})${rest}`;
}

/** A missing return annotation can use a short checker type. Longer types stay omitted. */
export function returnTypeSuffix(typeText: string | undefined): string {
  const text = typeText?.trim() ?? "";
  if (
    !text ||
    text.length > 200 ||
    text.includes("...") ||
    text.includes("\n") ||
    text === "any"
  )
    return "";
  return `: ${text};`;
}

export function withReturnType(
  signature: string,
  printed: string | undefined,
): string {
  const suffix = returnTypeSuffix(printed);
  if (!suffix || /\)\s*:/.test(signature)) return signature;
  return `${signature.replace(/;\s*$/, "")}${suffix}`;
}

/** Keep the public class surface and drop implementation bodies. */
export function presentClass(text: string): string {
  if (!/^class\b/.test(text)) return text;
  const open = classBodyOpen(text);
  if (open < 0) return text;
  const close = matchingBrace(text, open);
  if (close < 0) return text;
  const head = text.slice(0, open).trimEnd();
  const members = classMembers(text.slice(open + 1, close));
  return members ? `${head} {\n${members}\n}` : `${head} {}`;
}

function classBodyOpen(text: string): number {
  let angle = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "<" && text[index + 1] !== "=") angle += 1;
    else if (char === ">" && text[index - 1] !== "=" && angle > 0) angle -= 1;
    else if (char === "{" && angle === 0) return index;
  }
  return -1;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function classMembers(body: string): string {
  const members: string[] = [];
  let start = 0;
  let brace = 0;
  let paren = 0;
  let angle = 0;
  const emit = (end: number) => {
    const member = body.slice(start, end).trim().replace(/;\s*$/, "");
    start = end;
    if (!member || hiddenMember(member)) return;
    members.push(`  ${member};`);
  };
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index);
    if (char === "(") paren += 1;
    else if (char === ")") paren = Math.max(0, paren - 1);
    else if (char === "<" && body[index + 1] !== "=") angle += 1;
    else if (char === ">" && body[index - 1] !== "=" && angle > 0) angle -= 1;
    else if (char === "{") {
      if (
        brace === 0 &&
        paren === 0 &&
        angle === 0 &&
        implementationBrace(body, index)
      ) {
        emit(index);
        const close = matchingBrace(body, index);
        index = Math.max(index, close);
        start = index + 1;
        continue;
      }
      brace += 1;
    } else if (char === "}") brace = Math.max(0, brace - 1);
    else if (char === ";" && brace === 0 && paren === 0 && angle === 0)
      emit(index + 1);
  }
  emit(body.length);
  return members.join("\n");
}

function hiddenMember(member: string): boolean {
  return (
    member.startsWith("#") ||
    /^(?:declare\s+|public\s+|static\s+|abstract\s+|override\s+|readonly\s+|async\s+|get\s+|set\s+)*(?:private|protected)\b/.test(
      member,
    )
  );
}

function implementationBrace(text: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = text.charAt(cursor);
    if (/\s/.test(char)) continue;
    return char === ")" || char === ">" || /[A-Za-z0-9_]/.test(char);
  }
  return false;
}

export function inferredTypeSuffix(typeText: string | undefined): string {
  const text = typeText?.trim() ?? "";
  if (
    !text ||
    text.length > 80 ||
    text.includes("{") ||
    text.includes("\n") ||
    text === "any"
  )
    return "";
  return `: ${text}`;
}
