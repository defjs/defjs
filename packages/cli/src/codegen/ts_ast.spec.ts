import { Script } from "node:vm";
import { describe, expect, test } from "vitest";
import {
  arrExpr,
  arrayType,
  arrowFn,
  binaryExpr,
  block,
  callExpr,
  condExpr,
  constDecl,
  declareConst,
  emptyExport,
  exportAll,
  exportTypeAlias,
  exprStmt,
  getterProp,
  id,
  ifStmt,
  importNamed,
  indexSigType,
  intersectionType,
  kwType,
  literalExpr,
  literalType,
  markPure,
  namedTupleMember,
  newExpr,
  objExpr,
  printPlannedAstFiles,
  printStatement,
  propAccess,
  propAssign,
  propSig,
  renderJsDoc,
  retStmt,
  shorthandProp,
  str,
  tupleType,
  typeLit,
  typeQuery,
  typeRef,
  unionType,
} from "./ts_ast.ts";

describe("@defjs/cli built-in TypeScript AST printer", () => {
  test("renders single-line, multi-line, escaped, and empty JSDoc blocks", () => {
    expect(renderJsDoc(undefined)).toBe("");
    expect(renderJsDoc([])).toBe("");
    expect(renderJsDoc(["Single */ doc"], "  ")).toBe(
      "  /** Single *\\/ doc */\n",
    );
    expect(renderJsDoc(["Line 1\n", "Line 3"], "  ")).toBe(
      "  /**\n   * Line 1\n   *\n   * Line 3\n   */\n",
    );
  });

  test("prints expressions with 2-space indent, native JSDoc, and pure annotations", () => {
    const pureStmt = constDecl(
      "schema",
      markPure(
        callExpr(propAccess(id("struct"), "object"), [
          objExpr(
            [
              propAssign(
                id("name"),
                callExpr(propAccess(id("struct"), "string")),
                ["User display name"],
              ),
              propAssign(str("x-meta"), literalExpr(null)),
              getterProp(id("self"), id("schema"), ["Recursive link"]),
              getterProp(str("alt-self"), id("schema")),
              shorthandProp("query"),
            ],
            true,
          ),
        ]),
      ),
      {
        isExport: true,
        jsDoc: ["Top schema"],
      },
    );

    expect(printStatement(pureStmt)).toBe(
      `/** Top schema */
export const schema = /*#__PURE__*/ struct.object({
  /** User display name */
  name: struct.string(),
  "x-meta": null,
  /** Recursive link */
  get self() {
    return schema;
  },
  get "alt-self"() {
    return schema;
  },
  query,
});`,
    );

    const aliasStmt = constDecl("alias", markPure(id("schema")));
    expect(printStatement(aliasStmt)).toBe("const alias = schema;");

    const literalsStmt = constDecl(
      "values",
      arrExpr(
        [
          literalExpr("hi"),
          literalExpr(-1),
          literalExpr(true),
          literalExpr(false),
          literalExpr(null),
          arrExpr([]),
          arrExpr([id("a"), id("b")], true),
          objExpr([], false),
          objExpr([propAssign(id("k"), id("v")), shorthandProp("s")], false),
          newExpr(id("URLSearchParams")),
          newExpr(id("Error"), [str("boom")]),
          arrowFn(["x"], propAccess(id("x"), "id", true)),
          arrowFn(
            ["x"],
            objExpr([propAssign(id("ok"), literalExpr(true))], false),
          ),
          arrowFn(["x"], block([])),
          arrowFn(
            ["x"],
            block([
              ifStmt(binaryExpr(id("x"), "!==", id("undefined")), [
                exprStmt(
                  condExpr(
                    binaryExpr(
                      id("x"),
                      "&&",
                      binaryExpr(id("x"), "??", literalExpr(false)),
                    ),
                    callExpr(id("keep"), [id("x")]),
                    id("undefined"),
                  ),
                ),
                retStmt(id("x")),
              ]),
            ]),
          ),
        ],
        false,
      ),
    );

    const printed = printStatement(literalsStmt);
    expect(printed).toContain("[\n  a,\n  b,\n]");
    expect(printed).toContain("{ k: v, s }");
    expect(printed).toContain("new URLSearchParams()");
    expect(printed).toContain('new Error("boom")');
    expect(printed).toContain("(x) => x?.id");
    expect(printed).toContain("(x) => ({ ok: true })");
    expect(printed).toContain("(x) => {}");
    expect(printed).toContain(
      "  if (x !== undefined) {\n    x && (x ?? false) ? keep(x) : undefined;\n    return x;\n  }",
    );
  });

  test("enforces operator precedence, mixing parentheses, inline object getters/docs, and type wrapping", () => {
    const stmt = constDecl(
      "precedence",
      arrExpr(
        [
          // && vs ?? mixing in both directions
          binaryExpr(binaryExpr(id("a"), "??", id("b")), "&&", id("c")),
          binaryExpr(id("a"), "??", binaryExpr(id("b"), "&&", id("c"))),
          binaryExpr(binaryExpr(id("a"), "&&", id("b")), "??", id("c")),
          // Right-nested equal-precedence and lower-precedence binary children
          binaryExpr(id("a"), "!==", binaryExpr(id("b"), "!==", id("c"))),
          binaryExpr(
            arrowFn(["v"], id("v")),
            "??",
            condExpr(id("a"), id("b"), id("c")),
          ),
          // Conditional in conditional.condition
          condExpr(condExpr(id("a"), id("b"), id("c")), id("d"), id("e")),
          condExpr(arrowFn(["v"], id("v")), id("d"), id("e")),
          // Number literal and lower-precedence bases in propertyAccess
          propAccess(literalExpr(1), "toString"),
          propAccess(binaryExpr(id("a"), "??", id("b")), "length", true),
          propAccess(markPure(callExpr(id("make"))), "ok"),
          // Lower-precedence / numberLiteral callee in call and call / optional chain in new
          callExpr(arrowFn(["x"], id("x")), [id("a")]),
          callExpr(literalExpr(1)),
          newExpr(callExpr(id("getCtor"))),
          newExpr(propAccess(propAccess(id("ns"), "sub", true), "Ctor")),
          newExpr(binaryExpr(id("A"), "??", id("B"))),
          // Arrow body starting with '{' via propertyAccess on object literal
          arrowFn(["x"], propAccess(objExpr([shorthandProp("x")], false), "x")),
          // Single-line object with inline docs, multi-line JSDoc flattened, and single-line getter
          objExpr(
            [
              propAssign(id("a"), literalExpr(1), ["Inline doc"]),
              propAssign(id("b"), literalExpr(2), ["Line 1\nLine 2 */"]),
              getterProp(id("g"), id("a")),
              shorthandProp("s"),
            ],
            false,
          ),
        ],
        true,
      ),
    );

    const out = printStatement(stmt);
    expect(out).toContain("(a ?? b) && c");
    expect(out).toContain("a ?? (b && c)");
    expect(out).toContain("(a && b) ?? c");
    expect(out).toContain("a !== (b !== c)");
    expect(out).toContain("((v) => v) ?? (a ? b : c)");
    expect(out).toContain("(a ? b : c) ? d : e");
    expect(out).toContain("((v) => v) ? d : e");
    expect(out).toContain("(1).toString");
    expect(out).toContain("(a ?? b)?.length");
    expect(out).toContain("(/*#__PURE__*/ make()).ok");
    expect(out).toContain("((x) => x)(a)");
    expect(out).toContain("(1)()");
    expect(out).toContain("new (getCtor())()");
    expect(out).toContain("new (ns?.sub.Ctor)()");
    expect(out).toContain("new (A ?? B)()");
    expect(out).toContain("(x) => ({ x }.x)");
    expect(out).toContain(
      "{ /** Inline doc */ a: 1, /** Line 1 Line 2 *\\/ */ b: 2, get g() { return a; }, s }",
    );

    // Every emitted expression must parse as valid JavaScript without syntax errors.
    expect(() => new Script(out)).not.toThrow();

    const typeofArray = exportTypeAlias(
      "QueryArr",
      typeLit([
        propSig(str("x-key"), arrayType(typeQuery("Foo")), false),
        propSig(id("plain"), kwType("string"), true),
      ]),
    );
    expect(printStatement(typeofArray)).toBe(
      `export type QueryArr = {
  "x-key": (typeof Foo)[];
  plain?: string;
};`,
    );
  });

  test("prints types with proper precedence, 2-space indent, and planned files", () => {
    const complexType = exportTypeAlias(
      "Complex",
      intersectionType([
        unionType([
          kwType("string"),
          intersectionType([typeRef("A"), typeRef("B", [])]),
        ]),
        arrayType(unionType([kwType("number"), literalType(null)])),
        arrayType(intersectionType([kwType("boolean"), literalType("ok")])),
        arrayType(kwType("unknown")),
        tupleType([
          namedTupleMember("req", kwType("never"), false),
          namedTupleMember("opt", kwType("undefined"), true),
          literalType(false),
        ]),
        indexSigType("k", typeQuery("Foo")),
        typeLit([]),
        typeLit([
          propSig("flag", literalType(true), false, ["Flag doc"]),
          propSig("note", literalType(-2), true),
        ]),
        typeRef("Record", [kwType("string"), kwType("unknown")]),
      ]),
      { jsDoc: ["Complex type"] },
    );

    const printedType = printStatement(complexType);
    expect(printedType).toBe(
      `/** Complex type */
export type Complex = (string | (A & B)) & (number | null)[] & (boolean & "ok")[] & unknown[] & [req: never, opt?: undefined, false] & { [k: string]: typeof Foo; } & {} & {
  /** Flag doc */
  flag: true;
  note?: -2;
} & Record<string, unknown>;`,
    );

    const planned = printPlannedAstFiles([
      {
        path: "index.ts",
        header: "// header",
        groups: [
          [
            importNamed(["A"], "./a", false),
            importNamed(["B"], "./b", true),
            exportAll("./c"),
            emptyExport(),
            declareConst("entry", typeRef("A"), { jsDoc: ["Entry doc"] }),
            declareConst("plain", kwType("string")),
          ],
        ],
      },
    ]);

    expect(planned).toEqual([
      {
        path: "index.ts",
        content: `// header
import { A } from "./a";
import type { B } from "./b";
export * from "./c";
export {};
/** Entry doc */
export declare const entry: A;
export declare const plain: string;
`,
      },
    ]);
  });
});
