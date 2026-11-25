const INDENT_UNIT = "  ";

type AstKeywordTypeName =
  "string" | "number" | "boolean" | "unknown" | "undefined" | "never";

type AstBinaryOperator = "!==" | "&&" | "??";

type AstPrimitiveValue = string | number | boolean | null;

interface AstIdentifier {
  readonly kind: "identifier";
  readonly name: string;
}

interface AstStringLiteral {
  readonly kind: "stringLiteral";
  readonly value: string;
}

interface AstNumberLiteral {
  readonly kind: "numberLiteral";
  readonly value: number;
}

interface AstBooleanLiteral {
  readonly kind: "booleanLiteral";
  readonly value: boolean;
}

interface AstNullLiteral {
  readonly kind: "nullLiteral";
}

type AstPropertyName = AstIdentifier | AstStringLiteral;

interface AstPropertyAssignment {
  readonly kind: "property";
  readonly name: AstPropertyName;
  readonly initializer: AstExpression;
  readonly jsDoc?: readonly string[];
}

interface AstShorthandProperty {
  readonly kind: "shorthandProperty";
  readonly name: string;
}

interface AstGetterProperty {
  readonly kind: "getter";
  readonly name: AstPropertyName;
  readonly returnValue: AstExpression;
  readonly jsDoc?: readonly string[];
}

export type AstObjectMember =
  AstPropertyAssignment | AstShorthandProperty | AstGetterProperty;

interface AstPropertyAccess {
  readonly kind: "propertyAccess";
  readonly expression: AstExpression;
  readonly name: string;
  readonly optional: boolean;
}

interface AstCallExpression {
  readonly kind: "call";
  readonly callee: AstExpression;
  readonly args: readonly AstExpression[];
  readonly pure?: boolean;
}

interface AstNewExpression {
  readonly kind: "new";
  readonly callee: AstExpression;
  readonly args: readonly AstExpression[];
}

interface AstArrayExpression {
  readonly kind: "array";
  readonly elements: readonly AstExpression[];
  readonly multiLine: boolean;
}

interface AstObjectExpression {
  readonly kind: "object";
  readonly properties: readonly AstObjectMember[];
  readonly multiLine: boolean;
}

interface AstArrowFunction {
  readonly kind: "arrowFunction";
  readonly params: readonly string[];
  readonly body: AstExpression | AstBlock;
}

interface AstBinaryExpression {
  readonly kind: "binary";
  readonly left: AstExpression;
  readonly operator: AstBinaryOperator;
  readonly right: AstExpression;
}

interface AstConditionalExpression {
  readonly kind: "conditional";
  readonly condition: AstExpression;
  readonly whenTrue: AstExpression;
  readonly whenFalse: AstExpression;
}

export type AstExpression =
  | AstIdentifier
  | AstStringLiteral
  | AstNumberLiteral
  | AstBooleanLiteral
  | AstNullLiteral
  | AstPropertyAccess
  | AstCallExpression
  | AstNewExpression
  | AstArrayExpression
  | AstObjectExpression
  | AstArrowFunction
  | AstBinaryExpression
  | AstConditionalExpression;

interface AstBlock {
  readonly kind: "block";
  readonly statements: readonly AstStatement[];
}

interface AstVariableStatement {
  readonly kind: "variable";
  readonly name: string;
  readonly initializer?: AstExpression;
  readonly type?: AstTypeNode;
  readonly isExport?: boolean;
  readonly isDeclare?: boolean;
  readonly jsDoc?: readonly string[];
}

interface AstIfStatement {
  readonly kind: "if";
  readonly condition: AstExpression;
  readonly body: AstBlock;
}

interface AstReturnStatement {
  readonly kind: "return";
  readonly expression: AstExpression;
}

interface AstExpressionStatement {
  readonly kind: "expressionStmt";
  readonly expression: AstExpression;
}

interface AstImportDeclaration {
  readonly kind: "import";
  readonly names: readonly string[];
  readonly specifier: string;
  readonly isTypeOnly: boolean;
}

interface AstExportAllDeclaration {
  readonly kind: "exportAll";
  readonly specifier: string;
}

interface AstEmptyExportDeclaration {
  readonly kind: "emptyExport";
}

interface AstTypeAliasDeclaration {
  readonly kind: "typeAlias";
  readonly name: string;
  readonly type: AstTypeNode;
  readonly jsDoc?: readonly string[];
}

export type AstStatement =
  | AstVariableStatement
  | AstIfStatement
  | AstReturnStatement
  | AstExpressionStatement
  | AstImportDeclaration
  | AstExportAllDeclaration
  | AstEmptyExportDeclaration
  | AstTypeAliasDeclaration;

interface AstKeywordType {
  readonly kind: "keywordType";
  readonly keyword: AstKeywordTypeName;
}

interface AstLiteralType {
  readonly kind: "literalType";
  readonly value: AstPrimitiveValue;
}

interface AstTypeReference {
  readonly kind: "typeRef";
  readonly name: string;
  readonly typeArguments?: readonly AstTypeNode[];
}

interface AstArrayType {
  readonly kind: "arrayType";
  readonly elementType: AstTypeNode;
}

interface AstNamedTupleMember {
  readonly kind: "namedTupleMember";
  readonly name: string;
  readonly type: AstTypeNode;
  readonly optional: boolean;
}

interface AstTupleType {
  readonly kind: "tupleType";
  readonly elements: readonly (AstTypeNode | AstNamedTupleMember)[];
}

interface AstUnionType {
  readonly kind: "union";
  readonly types: readonly AstTypeNode[];
}

interface AstIntersectionType {
  readonly kind: "intersection";
  readonly types: readonly AstTypeNode[];
}

interface AstPropertySignature {
  readonly kind: "propSig";
  readonly name: AstPropertyName | string;
  readonly type: AstTypeNode;
  readonly optional: boolean;
  readonly jsDoc?: readonly string[];
}

interface AstIndexSignatureType {
  readonly kind: "indexSigType";
  readonly keyName: string;
  readonly valueType: AstTypeNode;
}

interface AstTypeLiteral {
  readonly kind: "typeLiteral";
  readonly members: readonly AstPropertySignature[];
}

interface AstTypeQuery {
  readonly kind: "typeQuery";
  readonly name: string;
}

export type AstTypeNode =
  | AstKeywordType
  | AstLiteralType
  | AstTypeReference
  | AstArrayType
  | AstTupleType
  | AstUnionType
  | AstIntersectionType
  | AstIndexSignatureType
  | AstTypeLiteral
  | AstTypeQuery;

export interface PlannedAstFile {
  readonly path: string;
  readonly header: string;
  readonly groups: readonly (readonly AstStatement[])[];
}

export function id(name: string): AstIdentifier {
  return { kind: "identifier", name };
}

export function str(value: string): AstStringLiteral {
  return { kind: "stringLiteral", value };
}

export function literalExpr(value: AstPrimitiveValue): AstExpression {
  if (value === null) {
    return { kind: "nullLiteral" };
  }
  switch (typeof value) {
    case "string":
      return str(value);
    case "boolean":
      return { kind: "booleanLiteral", value };
    case "number":
      return { kind: "numberLiteral", value };
  }
}

export function propAccess(
  expression: AstExpression,
  name: string,
  optional = false,
): AstPropertyAccess {
  return { kind: "propertyAccess", expression, name, optional };
}

export function callExpr(
  callee: AstExpression,
  args: readonly AstExpression[] = [],
  pure = false,
): AstCallExpression {
  return { kind: "call", callee, args, pure };
}

export function markPure(expr: AstExpression): AstExpression {
  if (expr.kind === "call") {
    return { ...expr, pure: true };
  }
  return expr;
}

export function newExpr(
  callee: AstExpression,
  args: readonly AstExpression[] = [],
): AstNewExpression {
  return { kind: "new", callee, args };
}

export function arrExpr(
  elements: readonly AstExpression[],
  multiLine = false,
): AstArrayExpression {
  return { kind: "array", elements, multiLine };
}

export function objExpr(
  properties: readonly AstObjectMember[],
  multiLine: boolean,
): AstObjectExpression {
  return { kind: "object", properties, multiLine };
}

export function propAssign(
  name: AstPropertyName,
  initializer: AstExpression,
  jsDoc?: readonly string[],
): AstPropertyAssignment {
  return { kind: "property", name, initializer, jsDoc };
}

export function shorthandProp(name: string): AstShorthandProperty {
  return { kind: "shorthandProperty", name };
}

export function getterProp(
  name: AstPropertyName,
  returnValue: AstExpression,
  jsDoc?: readonly string[],
): AstGetterProperty {
  return { kind: "getter", name, returnValue, jsDoc };
}

export function arrowFn(
  params: readonly string[],
  body: AstExpression | AstBlock,
): AstArrowFunction {
  return { kind: "arrowFunction", params, body };
}

export function block(statements: readonly AstStatement[]): AstBlock {
  return { kind: "block", statements };
}

export function constDecl(
  name: string,
  initializer: AstExpression,
  options?: {
    readonly isExport?: boolean;
    readonly type?: AstTypeNode;
    readonly jsDoc?: readonly string[];
  },
): AstVariableStatement {
  return {
    kind: "variable",
    name,
    initializer,
    isExport: options?.isExport,
    type: options?.type,
    jsDoc: options?.jsDoc,
  };
}

export function declareConst(
  name: string,
  type: AstTypeNode,
  options?: { readonly jsDoc?: readonly string[] },
): AstVariableStatement {
  return {
    kind: "variable",
    name,
    type,
    isExport: true,
    isDeclare: true,
    jsDoc: options?.jsDoc,
  };
}

export function ifStmt(
  condition: AstExpression,
  statements: readonly AstStatement[],
): AstIfStatement {
  return { kind: "if", condition, body: block(statements) };
}

export function retStmt(expression: AstExpression): AstReturnStatement {
  return { kind: "return", expression };
}

export function exprStmt(expression: AstExpression): AstExpressionStatement {
  return { kind: "expressionStmt", expression };
}

export function binaryExpr(
  left: AstExpression,
  operator: AstBinaryOperator,
  right: AstExpression,
): AstBinaryExpression {
  return { kind: "binary", left, operator, right };
}

export function condExpr(
  condition: AstExpression,
  whenTrue: AstExpression,
  whenFalse: AstExpression,
): AstConditionalExpression {
  return { kind: "conditional", condition, whenTrue, whenFalse };
}

export function importNamed(
  names: readonly string[],
  specifier: string,
  isTypeOnly = false,
): AstImportDeclaration {
  return { kind: "import", names, specifier, isTypeOnly };
}

export function exportAll(specifier: string): AstExportAllDeclaration {
  return { kind: "exportAll", specifier };
}

export function emptyExport(): AstEmptyExportDeclaration {
  return { kind: "emptyExport" };
}

export function exportTypeAlias(
  name: string,
  type: AstTypeNode,
  options?: { readonly jsDoc?: readonly string[] },
): AstTypeAliasDeclaration {
  return { kind: "typeAlias", name, type, jsDoc: options?.jsDoc };
}

export function typeRef(
  name: string,
  typeArguments?: readonly AstTypeNode[],
): AstTypeReference {
  return {
    kind: "typeRef",
    name,
    typeArguments:
      typeArguments && typeArguments.length > 0 ? typeArguments : undefined,
  };
}

export function kwType(keyword: AstKeywordTypeName): AstKeywordType {
  return { kind: "keywordType", keyword };
}

export function literalType(value: AstPrimitiveValue): AstLiteralType {
  return { kind: "literalType", value };
}

export function arrayType(elementType: AstTypeNode): AstArrayType {
  return { kind: "arrayType", elementType };
}

export function tupleType(
  elements: readonly (AstTypeNode | AstNamedTupleMember)[],
): AstTupleType {
  return { kind: "tupleType", elements };
}

export function namedTupleMember(
  name: string,
  type: AstTypeNode,
  optional: boolean,
): AstNamedTupleMember {
  return { kind: "namedTupleMember", name, type, optional };
}

export function unionType(types: readonly AstTypeNode[]): AstUnionType {
  return { kind: "union", types };
}

export function intersectionType(
  types: readonly AstTypeNode[],
): AstIntersectionType {
  return { kind: "intersection", types };
}

export function indexSigType(
  keyName: string,
  valueType: AstTypeNode,
): AstIndexSignatureType {
  return { kind: "indexSigType", keyName, valueType };
}

export function propSig(
  name: AstPropertyName | string,
  type: AstTypeNode,
  optional: boolean,
  jsDoc?: readonly string[],
): AstPropertySignature {
  return { kind: "propSig", name, type, optional, jsDoc };
}

export function typeLit(
  members: readonly AstPropertySignature[],
): AstTypeLiteral {
  return { kind: "typeLiteral", members };
}

export function typeQuery(name: string): AstTypeQuery {
  return { kind: "typeQuery", name };
}

export function renderJsDoc(
  lines: readonly string[] | undefined,
  indent = "",
): string {
  if (!lines || lines.length === 0) {
    return "";
  }
  const expanded: string[] = [];
  for (const line of lines) {
    for (const part of line.replaceAll("*/", "*\\/").split(/\r?\n/)) {
      expanded.push(part);
    }
  }
  if (expanded.length === 1) {
    return `${indent}/** ${expanded.join("")} */\n`;
  }
  const body = expanded
    .map((line) => (line === "" ? `${indent} *` : `${indent} * ${line}`))
    .join("\n");
  return `${indent}/**\n${body}\n${indent} */\n`;
}

function indentStr(depth: number): string {
  return INDENT_UNIT.repeat(depth);
}

function printPropertyName(name: AstPropertyName): string {
  switch (name.kind) {
    case "identifier":
      return name.name;
    case "stringLiteral":
      return JSON.stringify(name.value);
  }
}

function printInlineJsDoc(lines: readonly string[] | undefined): string {
  if (!lines || lines.length === 0) {
    return "";
  }
  const flattened = lines
    .join(" ")
    .replaceAll("*/", "*\\/")
    .replace(/\r?\n/g, " ");
  return `/** ${flattened} */ `;
}

function printObjectMember(
  member: AstObjectMember,
  depth: number,
  multiLine: boolean,
): string {
  switch (member.kind) {
    case "shorthandProperty":
      return member.name;
    case "property":
      return `${printPropertyName(member.name)}: ${printExpression(member.initializer, depth)}`;
    case "getter": {
      if (!multiLine) {
        return `get ${printPropertyName(member.name)}() { return ${printExpression(member.returnValue, depth)}; }`;
      }
      const bodyIndent = indentStr(depth + 1);
      const closeIndent = indentStr(depth);
      return `get ${printPropertyName(member.name)}() {\n${bodyIndent}return ${printExpression(member.returnValue, depth + 1)};\n${closeIndent}}`;
    }
  }
}

function binaryPrecedence(operator: AstBinaryOperator): number {
  switch (operator) {
    case "!==":
      return 8;
    case "&&":
      return 4;
    case "??":
      return 3;
  }
}

function exprPrecedence(expr: AstExpression): number {
  switch (expr.kind) {
    case "identifier":
    case "stringLiteral":
    case "booleanLiteral":
    case "nullLiteral":
    case "array":
    case "object":
      return 20;
    case "numberLiteral":
      return 19;
    case "propertyAccess":
    case "call":
    case "new":
      return 18;
    case "binary":
      return binaryPrecedence(expr.operator);
    case "conditional":
      return 2;
    case "arrowFunction":
      return 1;
  }
}

function hasOptionalChain(expr: AstExpression): boolean {
  if (expr.kind === "propertyAccess") {
    return expr.optional || hasOptionalChain(expr.expression);
  }
  return false;
}

function wrapExprIf(
  expr: AstExpression,
  needsParens: boolean,
  depth: number,
): string {
  const printed = printExpression(expr, depth);
  return needsParens ? `(${printed})` : printed;
}

function isMixedAndCoalesce(
  parentOp: AstBinaryOperator,
  child: AstExpression,
): boolean {
  return (
    child.kind === "binary" &&
    ((parentOp === "&&" && child.operator === "??") ||
      (parentOp === "??" && child.operator === "&&"))
  );
}

function printExpression(expr: AstExpression, depth: number): string {
  switch (expr.kind) {
    case "identifier":
      return expr.name;
    case "stringLiteral":
      return JSON.stringify(expr.value);
    case "numberLiteral":
      return String(expr.value);
    case "booleanLiteral":
      return expr.value ? "true" : "false";
    case "nullLiteral":
      return "null";
    case "propertyAccess": {
      const baseNeedsParens =
        exprPrecedence(expr.expression) < 18 ||
        expr.expression.kind === "numberLiteral" ||
        (expr.expression.kind === "call" && expr.expression.pure === true);
      return `${wrapExprIf(expr.expression, baseNeedsParens, depth)}${expr.optional ? "?." : "."}${expr.name}`;
    }
    case "call": {
      const purePrefix = expr.pure ? "/*#__PURE__*/ " : "";
      const calleeNeedsParens =
        exprPrecedence(expr.callee) < 18 ||
        expr.callee.kind === "numberLiteral";
      const args = expr.args
        .map((arg) => printExpression(arg, depth))
        .join(", ");
      return `${purePrefix}${wrapExprIf(expr.callee, calleeNeedsParens, depth)}(${args})`;
    }
    case "new": {
      const calleeNeedsParens =
        exprPrecedence(expr.callee) < 18 ||
        expr.callee.kind === "numberLiteral" ||
        expr.callee.kind === "call" ||
        hasOptionalChain(expr.callee);
      const args = expr.args
        .map((arg) => printExpression(arg, depth))
        .join(", ");
      return `new ${wrapExprIf(expr.callee, calleeNeedsParens, depth)}(${args})`;
    }
    case "array": {
      if (expr.elements.length === 0) {
        return "[]";
      }
      if (!expr.multiLine) {
        return `[${expr.elements.map((el) => printExpression(el, depth)).join(", ")}]`;
      }
      const itemIndent = indentStr(depth + 1);
      const closeIndent = indentStr(depth);
      const items = expr.elements
        .map((el) => `${itemIndent}${printExpression(el, depth + 1)},`)
        .join("\n");
      return `[\n${items}\n${closeIndent}]`;
    }
    case "object": {
      if (expr.properties.length === 0) {
        return "{}";
      }
      if (!expr.multiLine) {
        const inline = expr.properties
          .map((member) => {
            const doc =
              member.kind === "shorthandProperty"
                ? ""
                : printInlineJsDoc(member.jsDoc);
            return `${doc}${printObjectMember(member, depth, false)}`;
          })
          .join(", ");
        return `{ ${inline} }`;
      }
      const memberIndent = indentStr(depth + 1);
      const closeIndent = indentStr(depth);
      const lines = expr.properties.map((member) => {
        const doc =
          member.kind === "shorthandProperty"
            ? ""
            : renderJsDoc(member.jsDoc, memberIndent);
        return `${doc}${memberIndent}${printObjectMember(member, depth + 1, true)},`;
      });
      return `{\n${lines.join("\n")}\n${closeIndent}}`;
    }
    case "arrowFunction": {
      const paramsText = `(${expr.params.join(", ")})`;
      if (expr.body.kind === "block") {
        return `${paramsText} => ${printBlock(expr.body, depth)}`;
      }
      const bodyText = printExpression(expr.body, depth);
      if (bodyText.startsWith("{")) {
        return `${paramsText} => (${bodyText})`;
      }
      return `${paramsText} => ${bodyText}`;
    }
    case "binary": {
      const myPrec = exprPrecedence(expr);
      const leftNeedsParens =
        exprPrecedence(expr.left) < myPrec ||
        isMixedAndCoalesce(expr.operator, expr.left);
      const rightNeedsParens =
        exprPrecedence(expr.right) < myPrec ||
        (expr.right.kind === "binary" &&
          exprPrecedence(expr.right) === myPrec) ||
        isMixedAndCoalesce(expr.operator, expr.right);
      return `${wrapExprIf(expr.left, leftNeedsParens, depth)} ${expr.operator} ${wrapExprIf(expr.right, rightNeedsParens, depth)}`;
    }
    case "conditional": {
      const condNeedsParens = exprPrecedence(expr.condition) <= 2;
      return `${wrapExprIf(expr.condition, condNeedsParens, depth)} ? ${printExpression(expr.whenTrue, depth)} : ${printExpression(expr.whenFalse, depth)}`;
    }
  }
}

function printBlock(blk: AstBlock, depth: number): string {
  if (blk.statements.length === 0) {
    return "{}";
  }
  const closeIndent = indentStr(depth);
  const body = blk.statements
    .map((stmt) => printStatement(stmt, depth + 1))
    .join("\n");
  return `{\n${body}\n${closeIndent}}`;
}

function printType(typeNode: AstTypeNode, depth: number): string {
  switch (typeNode.kind) {
    case "keywordType":
      return typeNode.keyword;
    case "literalType":
      return printExpression(literalExpr(typeNode.value), depth);
    case "typeRef":
      return typeNode.typeArguments
        ? `${typeNode.name}<${typeNode.typeArguments.map((arg) => printType(arg, depth)).join(", ")}>`
        : typeNode.name;
    case "arrayType": {
      const inner = printType(typeNode.elementType, depth);
      const needsParens =
        typeNode.elementType.kind === "union" ||
        typeNode.elementType.kind === "intersection" ||
        typeNode.elementType.kind === "typeQuery";
      return needsParens ? `(${inner})[]` : `${inner}[]`;
    }
    case "tupleType": {
      const items = typeNode.elements.map((el) =>
        el.kind === "namedTupleMember"
          ? `${el.name}${el.optional ? "?" : ""}: ${printType(el.type, depth)}`
          : printType(el, depth),
      );
      return `[${items.join(", ")}]`;
    }
    case "union":
      return typeNode.types
        .map((member) => {
          const text = printType(member, depth);
          return member.kind === "intersection" ? `(${text})` : text;
        })
        .join(" | ");
    case "intersection":
      return typeNode.types
        .map((member) => {
          const text = printType(member, depth);
          return member.kind === "union" ? `(${text})` : text;
        })
        .join(" & ");
    case "indexSigType":
      return `{ [${typeNode.keyName}: string]: ${printType(typeNode.valueType, depth)}; }`;
    case "typeLiteral": {
      if (typeNode.members.length === 0) {
        return "{}";
      }
      const memberIndent = indentStr(depth + 1);
      const closeIndent = indentStr(depth);
      const lines = typeNode.members.map((member) => {
        const doc = renderJsDoc(member.jsDoc, memberIndent);
        const opt = member.optional ? "?" : "";
        const propName =
          typeof member.name === "string"
            ? member.name
            : printPropertyName(member.name);
        return `${doc}${memberIndent}${propName}${opt}: ${printType(member.type, depth + 1)};`;
      });
      return `{\n${lines.join("\n")}\n${closeIndent}}`;
    }
    case "typeQuery":
      return `typeof ${typeNode.name}`;
  }
}

export function printStatement(stmt: AstStatement, depth = 0): string {
  const indent = indentStr(depth);
  switch (stmt.kind) {
    case "variable": {
      const doc = renderJsDoc(stmt.jsDoc, indent);
      const modExport = stmt.isExport ? "export " : "";
      const modDeclare = stmt.isDeclare ? "declare " : "";
      const typeAnn = stmt.type ? `: ${printType(stmt.type, depth)}` : "";
      const init = stmt.initializer
        ? ` = ${printExpression(stmt.initializer, depth)}`
        : "";
      return `${doc}${indent}${modExport}${modDeclare}const ${stmt.name}${typeAnn}${init};`;
    }
    case "if":
      return `${indent}if (${printExpression(stmt.condition, depth)}) ${printBlock(stmt.body, depth)}`;
    case "return":
      return `${indent}return ${printExpression(stmt.expression, depth)};`;
    case "expressionStmt":
      return `${indent}${printExpression(stmt.expression, depth)};`;
    case "import": {
      const typeKw = stmt.isTypeOnly ? "type " : "";
      return `${indent}import ${typeKw}{ ${stmt.names.join(", ")} } from ${JSON.stringify(stmt.specifier)};`;
    }
    case "exportAll":
      return `${indent}export * from ${JSON.stringify(stmt.specifier)};`;
    case "emptyExport":
      return `${indent}export {};`;
    case "typeAlias": {
      const doc = renderJsDoc(stmt.jsDoc, indent);
      return `${doc}${indent}export type ${stmt.name} = ${printType(stmt.type, depth)};`;
    }
  }
}

export function printPlannedAstFiles(
  files: readonly PlannedAstFile[],
): { readonly path: string; readonly content: string }[] {
  return files.map((file) => {
    const renderedGroups = file.groups.map((group) =>
      group.map((stmt) => printStatement(stmt)).join("\n"),
    );
    return {
      path: file.path,
      content: `${file.header}\n${renderedGroups.join("\n\n")}\n`,
    };
  });
}
