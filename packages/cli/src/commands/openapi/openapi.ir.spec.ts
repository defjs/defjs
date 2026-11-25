import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateOpenApi } from "../../index.ts";
import { createTempDir, loadGeneratedModule } from "../../../test/helpers.ts";
import { renderBundleDtsFiles } from "./emitter/render_dts.ts";
import { renderBundleCodeFiles } from "./emitter/render_ts.ts";
import { lowerOpenApiDocument } from "./ir/lower.ts";
import { collectNodeRefIds, requireSchemaDecl } from "./ir/schema.ts";

describe("@defjs/cli OpenAPI IR lowering, edge schemas, and sync lifecycle", () => {
  test("handles Swagger 2.0, schema variety, recursion, mutual SCCs, cycles, and warnings", async () => {
    const tmp = createTempDir("defjs-cli-shapes-");

    // 1. Swagger 2.0 YAML
    const swagger20 = `swagger: "2.0"
info: { title: Legacy, version: "1.0" }
paths:
  /legacy/{item_id}:
    post:
      parameters:
        - in: path
          name: item_id
          required: true
          type: string
        - in: formData
          name: label
          required: true
          type: string
        - in: formData
          name: doc
          type: file
      responses:
        "200":
          description: ok
          schema:
            $ref: "#/definitions/LegacyResult"
definitions:
  LegacyResult:
    type: object
    properties:
      status: { type: integer }
`;
    const swRes = await generateOpenApi({
      cwd: tmp,
      target: { input: swagger20, output: { dir: "./out-sw2" } },
    });
    expect(swRes.operationCount).toBe(1);
    const sw2SchemaCode = readFileSync(
      join(tmp, "out-sw2/schema/default.ts"),
      "utf8",
    );
    expect(sw2SchemaCode).toContain("struct.formData(");
    expect(sw2SchemaCode).toContain(
      "doc: /*#__PURE__*/ (/*#__PURE__*/ struct.file()).optional()",
    );
    expect(
      readFileSync(join(tmp, "out-sw2/request/default.ts"), "utf8"),
    ).not.toContain("struct.");

    // 2. Comprehensive schema constructs, mixed 2xx, path/body warnings, duplicate ops, mutual & non-object cycles
    const complexSpec = {
      openapi: "3.1.0",
      info: { title: "Complex", version: "1.0.0" },
      paths: {
        "/prefix-{id}/:literal": {
          get: {
            tags: ["Edge"],
            parameters: [
              {
                in: "path",
                name: "id",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: { "text/plain": { schema: { type: "string" } } },
            },
            responses: { "204": { description: "empty" } },
          },
        },
        "/{query}": {
          post: {
            tags: ["Edge"],
            operationId: "dupOp",
            parameters: [
              {
                in: "path",
                name: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: false,
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            responses: {
              "200": {
                description: "json",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/MutualA" },
                  },
                },
              },
              "204": { description: "empty" },
            },
          },
        },
        "/dup-second": {
          post: {
            tags: ["Edge"],
            operationId: "dup_op",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "text/event-stream": { schema: { type: "string" } },
                },
              },
            },
          },
        },
        "/other-group": {
          get: {
            tags: ["Other"],
            parameters: [
              {
                in: "query",
                name: "type_list",
                style: "form",
                explode: true,
                schema: { type: ["string", "null"] },
              },
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/MutualB" },
                  },
                },
              },
              "400": {
                description: "err1",
                content: { "application/json": { schema: { type: "string" } } },
              },
              "500": {
                description: "err2",
                content: { "application/json": { schema: { type: "number" } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          MutualA: {
            type: "object",
            properties: {
              b: { $ref: "#/components/schemas/MutualB" },
            },
          },
          MutualB: {
            type: "object",
            properties: {
              a: { $ref: "#/components/schemas/MutualA" },
            },
          },
          BadArrayCycle: {
            type: "array",
            items: { $ref: "#/components/schemas/BadArrayCycle" },
          },
          Variants: {
            anyOf: [
              { const: 1 },
              { enum: [1, 2, null] },
              { enum: [null] },
              { enum: ["onlyOne"] },
              { enum: ["a", "b"] },
              { type: ["string", "number"] },
              { type: ["null"] },
              {
                type: "array",
                prefixItems: [{ type: "boolean" }, { type: "string" }],
                items: false,
              },
              { type: "array" },
              { properties: {} },
              { additionalProperties: { type: "number" } },
              {
                allOf: [
                  { type: "object", properties: { x: { type: "string" } } },
                ],
              },
              {
                allOf: [
                  { type: "object", properties: { x: { type: "string" } } },
                  { type: "object", properties: { y: { type: "number" } } },
                ],
              },
              {},
            ],
          },
        },
      },
    };

    const omitRes = await generateOpenApi({
      cwd: tmp,
      target: {
        input: complexSpec,
        output: { dir: "./out-complex-omit", format: "ts" },
        errorStrategy: "union",
        mixed2xxStrategy: "omit",
      },
    });
    const diagCodes = omitRes.diagnostics.map((d) => d.code);
    expect(diagCodes).toContain("CLI_UNSUPPORTED_PATH_TEMPLATE");
    expect(diagCodes).toContain("CLI_GET_HEAD_BODY_IGNORED");
    expect(diagCodes).toContain("CLI_DUPLICATE_OPERATION_NAME");
    expect(diagCodes).toContain("CLI_MIXED_2XX_RESPONSE");
    expect(diagCodes).toContain("CLI_UNSUPPORTED_NON_OBJECT_CYCLE");

    // Non-shared schemas used exclusively by one active group land in schema/<group>.ts
    const otherCode = readFileSync(
      join(tmp, "out-complex-omit/schema/other.ts"),
      "utf8",
    );
    expect(otherCode).toContain("export type MutualA");
    expect(otherCode).toContain("export type MutualB");

    // Verify "pathWrapperProp: path" for reserved `{query}` path parameter
    const edgeCode = readFileSync(
      join(tmp, "out-complex-omit/request/edge.ts"),
      "utf8",
    );
    expect(edgeCode).toContain("path: { query: input.path.query }");
    expect(edgeCode).toContain("Omitted `output`");

    // Verify mixed2xxStrategy: "split" + include/exclude + sync/scaffold/check lifecycle
    const splitDir = join(tmp, "out-split");
    const splitRes = await generateOpenApi({
      cwd: tmp,
      target: {
        input: complexSpec,
        output: { dir: splitDir, format: "js" },
        mixed2xxStrategy: "split",
        include: ["dupOp"],
      },
    });
    expect(splitRes.operationCount).toBe(2); // dupOp and dupOpNoContent (included by operationId)
    expect(readFileSync(join(splitDir, "request/edge.js"), "utf8")).toContain(
      "dupOpNoContent",
    );

    // Custom user file and symlink must survive sync cleanup; stale managed file must be deleted
    writeFileSync(join(splitDir, "custom-user.js"), "// hand-written\n");
    symlinkSync(
      join(splitDir, "custom-user.js"),
      join(splitDir, "symlink-user.js"),
    );
    writeFileSync(
      join(splitDir, "request/stale-old.js"),
      "// Generated by @defjs/cli. Do not edit directly.\nexport {};\n",
    );
    // Modify index.js to trigger rewrite
    writeFileSync(join(splitDir, "index.js"), "// stale content\n");

    const checkDrift = await generateOpenApi({
      cwd: tmp,
      check: true,
      target: {
        input: complexSpec,
        output: { dir: splitDir, format: "js" },
        mixed2xxStrategy: "split",
        include: ["dupOp"],
      },
    });
    expect(checkDrift.drifted).toContain("index.js");
    expect(checkDrift.drifted).toContain("request/stale-old.js");

    const syncRes = await generateOpenApi({
      cwd: tmp,
      target: {
        input: complexSpec,
        output: { dir: splitDir, format: "js" },
        mixed2xxStrategy: "split",
        include: ["dupOp"],
      },
    });
    expect(syncRes.deleted).toEqual(["request/stale-old.js"]);
    expect(syncRes.written).toContain("index.js");
    expect(existsSync(join(splitDir, "custom-user.js"))).toBe(true);
    expect(existsSync(join(splitDir, "symlink-user.js"))).toBe(true);

    // Scaffold mode preserves existing files and checks clean
    const scaffoldTarget = {
      input: complexSpec,
      output: { dir: splitDir, format: "js" },
      mode: "scaffold",
      mixed2xxStrategy: "split",
      exclude: ["GET /other-group"],
    } as const;
    const scaffoldCheck = await generateOpenApi({
      cwd: tmp,
      check: true,
      target: scaffoldTarget,
    });
    expect(scaffoldCheck.drifted).toEqual([]);
    const scaffoldRun = await generateOpenApi({
      cwd: tmp,
      target: scaffoldTarget,
    });
    expect(scaffoldRun.skipped.length).toBeGreaterThan(0);
    expect(scaffoldRun.written).toEqual([]);
  });

  test("covers root path, discriminators, diverging shared/recursive schemas, SSE errors, and Swagger 2.0 body/formData", async () => {
    const tmp = createTempDir("defjs-cli-edge-matrix-");

    // 1. Comprehensive Swagger 2.0 with in: body, in: formData (urlencoded), and unused definitions entry
    const sw2Url = `swagger: "2.0"
info: { title: Sw2Body, version: "1.0" }
paths:
  /sw-body:
    post:
      parameters:
        - in: body
          name: body
          required: true
          schema: { type: object, properties: { ok: { type: boolean } } }
      responses:
        "200": { description: ok }
  /sw-form:
    post:
      consumes: ["application/x-www-form-urlencoded"]
      parameters:
        - in: formData
          name: tag
          type: string
          required: false
      responses:
        "200": { description: ok }
definitions:
  UnusedDef:
    type: object
    properties:
      flag: { type: boolean }
`;
    const sw2Res = await generateOpenApi({
      cwd: tmp,
      target: { input: sw2Url, output: { dir: "./out-sw2-extra" } },
    });
    expect(sw2Res.schemaCount).toBe(3);
    expect(
      readFileSync(join(tmp, "out-sw2-extra/schema/default.ts"), "utf8"),
    ).toContain("struct.urlencoded(");
    expect(
      readFileSync(join(tmp, "out-sw2-extra/request/default.ts"), "utf8"),
    ).not.toContain("struct.");

    // 2. OpenAPI 3.2 edge schemas + cross-group diverging shared schemas + discriminator fallbacks + SSE variants
    const edgeSpec = {
      openapi: "3.1.0",
      info: { title: "Edge Matrix", version: "1.0.0" },
      paths: {
        "/": {
          get: {
            tags: ["Root"],
            operationId: "getRoot",
            responses: {
              "200": {
                description: "ref only",
                content: {
                  "application/vnd.api+json": {
                    schema: { $ref: "#/components/schemas/SharedPayload" },
                  },
                },
              },
            },
          },
        },
        "/binary-and-text": {
          post: {
            tags: ["Root"],
            operationId: "sendTextGetImage",
            parameters: [
              {
                in: "query",
                name: "ref_arr",
                style: "form",
                explode: true,
                schema: { $ref: "#/components/schemas/SharedTags" },
              },
              {
                in: "query",
                name: "ref_obj",
                style: "form",
                explode: false,
                schema: { $ref: "#/components/schemas/SharedFilter" },
              },
            ],
            requestBody: {
              required: true,
              content: { "text/plain": { schema: { type: "string" } } },
            },
            responses: {
              "200": {
                description: "png",
                content: { "image/png": {} },
              },
              "204": { description: "empty" },
            },
          },
        },
        "/events-single": {
          get: {
            tags: ["Alpha"],
            operationId: "streamSingleEvent",
            responses: {
              "200": {
                description: "stream",
                content: {
                  "text/event-stream": {
                    schema: {
                      type: "object",
                      required: ["event", "data"],
                      properties: {
                        event: { type: "string", const: "heartbeat" },
                        data: { $ref: "#/components/schemas/SharedPayload" },
                      },
                    },
                  },
                },
              },
              "5XX": {
                description: "server err",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/DivergingError" },
                  },
                },
              },
            },
          },
        },
        "/events-empty": {
          get: {
            tags: ["Beta"],
            operationId: "streamDefaultEvent",
            parameters: [
              {
                in: "query",
                name: "obj",
                style: "form",
                explode: true,
                schema: { $ref: "#/components/schemas/SharedPayload" },
              },
            ],
            responses: {
              "200": {
                description: "stream",
                content: {
                  "text/event-stream": {},
                },
              },
              default: {
                description: "default err",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["code"],
                      properties: { code: { type: "string", const: "E1" } },
                    },
                  },
                },
              },
              "4XX": {
                description: "dup code err",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["code"],
                      properties: { code: { type: "string", const: "E1" } },
                    },
                  },
                },
              },
            },
          },
        },
        "/alpha-only": {
          get: {
            tags: ["Alpha"],
            operationId: "getAlphaOnly",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/AlphaTree" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          SharedTags: { type: "array", items: { type: "string" } },
          SharedFilter: {
            type: "object",
            properties: {
              term: { type: "string", format: "email" },
              emptyDesc: { type: "string", description: "   " },
            },
          },
          SharedPayload: {
            type: "object",
            description: "Shared entity.\n\nSecond paragraph.",
            properties: {
              at: { type: "string", format: "date-time" },
              n: { type: "null" },
              nullableNull: { type: "null", nullable: true },
              enumBad: { enum: [{ nested: true }] },
              discValid: {
                discriminator: { propertyName: "kind" },
                oneOf: [
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { const: "a" } },
                  },
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { const: "b" } },
                  },
                ],
              },
              discDupTag: {
                discriminator: { propertyName: "kind" },
                oneOf: [
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { const: "a" } },
                  },
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { const: "a" } },
                  },
                ],
              },
              discMissingTag: {
                discriminator: { propertyName: "kind" },
                oneOf: [
                  { type: "object", properties: { x: { type: "string" } } },
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { const: "b" } },
                  },
                ],
              },
              discNonLiteralTag: {
                discriminator: { propertyName: "kind" },
                oneOf: [
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { type: "string" } },
                  },
                  {
                    type: "object",
                    required: ["kind"],
                    properties: { kind: { const: "b" } },
                  },
                ],
              },
              discNonObjVariant: {
                discriminator: { propertyName: "kind" },
                oneOf: [{ type: "string" }, { type: "number" }],
              },
              nullOnlyUnion: { oneOf: [{ type: "null" }] },
              stringOrNullConst: {
                oneOf: [{ type: "string" }, { const: null }],
              },
              nullableBool: { type: "boolean", nullable: true },
              inferredArray: { items: { type: "number" } },
              refTuple: {
                type: "array",
                prefixItems: [{ $ref: "#/components/schemas/SharedTags" }],
                items: false,
              },
              refRecord: {
                type: "object",
                additionalProperties: {
                  $ref: "#/components/schemas/SharedFilter",
                },
              },
              refAllOf: {
                allOf: [
                  { $ref: "#/components/schemas/SharedTags" },
                  { $ref: "#/components/schemas/SharedFilter" },
                ],
              },
            },
          },
          DivergingError: {
            type: "object",
            required: ["at"],
            properties: {
              at: { type: "string", format: "date-time" },
              shared: { $ref: "#/components/schemas/SharedPayload" },
            },
          },
          AlphaTree: {
            type: "object",
            properties: {
              wrapper: { $ref: "#/components/schemas/AlphaWrapper" },
              shared: { $ref: "#/components/schemas/SharedPayload" },
              recursiveOpt: { $ref: "#/components/schemas/AlphaNullableNode" },
            },
          },
          AlphaWrapper: {
            type: "object",
            properties: {
              back: { $ref: "#/components/schemas/AlphaTree" },
            },
          },
          AlphaNullableNode: {
            type: "object",
            nullable: true,
            properties: {
              next: { $ref: "#/components/schemas/AlphaNullableNode" },
            },
          },
        },
      },
    };

    for (const fmt of ["ts", "js"] as const) {
      const outDir = join(tmp, `edge-${fmt}`);
      const res = await generateOpenApi({
        cwd: tmp,
        target: {
          input: edgeSpec,
          output: { dir: outDir, format: fmt },
          errorStrategy: "union",
          mixed2xxStrategy: "split",
        },
      });
      expect(res.operationCount).toBe(6);
      const ext = fmt === "js" ? ".js" : ".ts";
      const rootCode = readFileSync(join(outDir, `request/root${ext}`), "utf8");
      expect(rootCode).toContain("sendTextGetImageNoContent");
      expect(
        readFileSync(join(outDir, `schema/shared${ext}`), "utf8"),
      ).toContain("struct.discriminatedUnion");
      if (fmt === "js") {
        expect(
          readFileSync(join(outDir, "request/alpha.d.ts"), "utf8"),
        ).toContain("Struct<DivergingErrorInput, DivergingError>");
        expect(
          readFileSync(join(outDir, "schema/alpha.d.ts"), "utf8"),
        ).toContain("SharedPayloadInput");
      }
      if (fmt === "ts") {
        expect(readFileSync(join(outDir, "schema/alpha.ts"), "utf8")).toContain(
          "SharedPayload",
        );
      }
    }

    // Empty operations for PathItem with no HTTP methods
    const oddPathsSpec = {
      openapi: "3.1.0",
      info: { title: "Odd", version: "1.0.0" },
      paths: {
        "/x": { description: "no methods" },
      },
    };
    const oddRes = await generateOpenApi({
      cwd: tmp,
      target: { input: oddPathsSpec, output: { dir: join(tmp, "odd-out") } },
    });
    expect(oddRes.operationCount).toBe(0);
  });

  test("covers synthetic IR edge branches, multi-file Swagger 2.0 params, constrained/nullable/cycle nodes, and emission", () => {
    expect(() => requireSchemaDecl(new Map(), "missing")).toThrow(
      "Missing schema declaration",
    );

    // 1. Direct IR lowering for multi-file / pre-upgrade Swagger 2.0 & exotic AST paths
    const sharedDate = {
      type: "object",
      minLength: 1,
      properties: { ts: { type: "string", format: "date-time" } },
    };
    const sharedPure = { type: "string" };
    const sharedLeaf = { type: "object", properties: { s: sharedPure } };
    const diamondLeft = { type: "object", properties: { l: sharedLeaf } };
    const diamondRight = { type: "object", properties: { r: sharedLeaf } };
    const leafCycle: { [key: string]: unknown } = {
      type: "object",
      properties: {},
    };
    leafCycle["properties"] = { self: leafCycle };

    const badNonObjCycle: { [key: string]: unknown } = {
      type: "array",
    };
    badNonObjCycle["items"] = badNonObjCycle;

    const dupWarnCycle: { [key: string]: unknown } = {};
    dupWarnCycle["oneOf"] = [
      dupWarnCycle,
      { type: "array", items: dupWarnCycle },
    ];

    // 3-node SCC (cycA -> cycB -> cycC -> cycA) + union inside cycle + non-cycle shared diamond
    const cycA: { [key: string]: unknown } = { type: "object", properties: {} };
    const cycB: { [key: string]: unknown } = { type: "object", properties: {} };
    const cycC: { [key: string]: unknown } = { type: "object", properties: {} };
    const unionInCycle = {
      oneOf: [cycA, { type: "string" }],
    };
    cycC["properties"] = { toA: cycA };
    cycB["properties"] = { toC: cycC };
    cycA["properties"] = {
      toB: cycB,
      branch: unionInCycle,
      leaf: leafCycle,
      diamondL: diamondLeft,
      diamondR: diamondRight,
      pure: sharedPure,
    };

    const refMeta = new WeakMap<
      object,
      { readonly key: string; readonly name: string }
    >();
    refMeta.set(sharedDate, {
      key: "#/components/schemas/SharedDate",
      name: "SharedDate",
    });
    refMeta.set(sharedPure, {
      key: "#/components/schemas/SharedPure",
      name: "SharedPure",
    });
    refMeta.set(sharedLeaf, {
      key: "#/components/schemas/SharedLeaf",
      name: "SharedLeaf",
    });
    refMeta.set(diamondLeft, {
      key: "#/components/schemas/DiamondLeft",
      name: "DiamondLeft",
    });
    refMeta.set(diamondRight, {
      key: "#/components/schemas/DiamondRight",
      name: "DiamondRight",
    });
    refMeta.set(leafCycle, {
      key: "#/components/schemas/LeafCycle",
      name: "LeafCycle",
    });
    refMeta.set(badNonObjCycle, {
      key: "#/components/schemas/BadNonObjCycle",
      name: "BadNonObjCycle",
    });
    refMeta.set(dupWarnCycle, {
      key: "#/components/schemas/DupWarnCycle",
      name: "DupWarnCycle",
    });
    refMeta.set(cycA, {
      key: "#/components/schemas/CycA",
      name: "CycA",
    });
    refMeta.set(cycB, {
      key: "#/components/schemas/CycB",
      name: "CycB",
    });
    refMeta.set(cycC, {
      key: "#/components/schemas/CycC",
      name: "CycC",
    });
    refMeta.set(unionInCycle, {
      key: "#/components/schemas/UnionInCycle",
      name: "UnionInCycle",
    });

    const emptyBundle = lowerOpenApiDocument(
      { openapi: "3.1.0" },
      new WeakMap(),
      { errorStrategy: "none", mixed2xxStrategy: "omit" },
    );
    expect(emptyBundle.operations).toEqual([]);

    const syntheticDoc = {
      swagger: "2.0",
      paths: {
        "": {
          get: {
            tags: ["Alpha"],
            operationId: "emptyPathWithHttpErr",
            parameters: [
              {
                in: "header",
                name: "X-Required",
                required: true,
                schema: { type: "string" },
              },
              { in: "header", name: "X-No-Schema" },
              { in: "query", name: "qNoSchema" },
            ],
            responses: {
              "200": { schema: sharedPure },
              "302": { description: "redirect" },
              "400": { schema: sharedPure },
              "422": { description: "empty error" },
            },
          },
        },
        "/undeclared/{raw_id}": {
          get: {
            tags: ["Alpha"],
            operationId: "undeclaredPathParam",
            responses: { "200": { schema: sharedPure } },
          },
          put: {
            tags: ["Alpha"],
            operationId: "noResponsesOp",
          },
        },
        "/ignored": "not-a-path-item",
        "/multi-sw2": {
          parameters: [null, { invalid: true }],
          post: {
            tags: ["Alpha"],
            operationId: "sw2Post",
            parameters: [
              { in: "body", name: "body", required: true, schema: sharedPure },
            ],
            responses: {
              "200": { schema: sharedDate },
              "400": { schema: { type: "string" } },
            },
          },
          get: "not-an-op",
          additionalOperations: {
            "": {
              tags: ["Alpha"],
              responses: { "204": { description: "blank key ignored" } },
            },
            BAD_OP: "not-an-op",
          },
        },
        "/querystring-edge": {
          get: {
            tags: ["Beta"],
            operationId: "querystringEdge",
            parameters: [
              {
                in: "querystring",
                name: "empty_qs",
                content: {},
              },
              {
                in: "querystring",
                name: "non_record_content",
                content: {
                  "application/x-custom": "not-an-object",
                  "text/plain": {},
                },
              },
              {
                in: "querystring",
                name: "urlenc_no_schema",
                content: {
                  "application/x-www-form-urlencoded": {},
                },
              },
              {
                in: "querystring",
                name: "first_urlenc",
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      properties: { a: { type: "string" } },
                    },
                  },
                },
              },
              {
                in: "querystring",
                name: "dup_urlenc",
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      properties: { b: { type: "string" } },
                    },
                  },
                },
              },
            ],
            responses: { "204": { description: "empty" } },
          },
          post: {
            tags: ["Beta"],
            operationId: "querystringCoexistWithQuery",
            parameters: [
              { in: "query", name: "a", schema: { type: "string" } },
              {
                in: "querystring",
                name: "qs",
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      properties: { b: { type: "string" } },
                    },
                  },
                },
              },
            ],
            responses: { "204": { description: "empty" } },
          },
        },
        "/multi-sw2-form": {
          post: {
            tags: ["Alpha"],
            operationId: "sw2Form",
            parameters: [
              { in: "formData", name: "title", required: false },
              {
                in: "formData",
                name: "bin",
                required: true,
                schema: { type: "string", format: "binary" },
              },
            ],
            responses: { "204": { description: "empty" } },
          },
        },
        "/multi-sw2-url": {
          post: {
            tags: ["Alpha"],
            operationId: "sw2UrlForm",
            parameters: [{ in: "formData", name: "note", required: true }],
            responses: { "204": { description: "empty" } },
          },
        },
        "/weird-content": {
          post: {
            tags: ["Beta"],
            operationId: "weirdContent",
            requestBody: {
              content: {
                "application/xml": { schema: { type: "string" } },
                notAnObject: "bad",
              },
            },
            responses: {
              "200": {
                content: {
                  notAnObject: "bad",
                  "application/xml": { schema: { type: "string" } },
                },
              },
            },
          },
          put: {
            tags: ["Beta"],
            operationId: "emptyReqBodyAndMultipartNoSchema",
            requestBody: {},
            responses: { "204": {} },
          },
          patch: {
            tags: ["Beta"],
            operationId: "multipartNoSchema",
            requestBody: { content: { "multipart/form-data": {} } },
            responses: { "204": {} },
          },
          delete: {
            tags: ["Beta"],
            operationId: "urlNoSchema",
            requestBody: {
              content: { "application/x-www-form-urlencoded": {} },
            },
            responses: { "204": {} },
          },
        },
        "/mixed-sse": {
          get: {
            tags: ["Beta"],
            operationId: "mixedSseFallback",
            description: "SSE description",
            responses: {
              "200": {
                content: {
                  "text/event-stream": {
                    itemSchema: {
                      oneOf: [
                        {
                          type: "object",
                          required: ["event", "data"],
                          properties: {
                            event: { const: "ok" },
                            data: { type: "string" },
                          },
                        },
                        {
                          type: "object",
                          properties: { malformed: { type: "number" } },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          post: {
            tags: ["Beta"],
            operationId: "dupSseNullableData",
            responses: {
              "200": {
                content: {
                  "text/event-stream": {
                    itemSchema: {
                      oneOf: [
                        {
                          type: "object",
                          required: ["event", "data"],
                          properties: {
                            event: { const: "ping" },
                            data: { type: "string", nullable: true },
                          },
                        },
                        {
                          type: "object",
                          required: ["event", "data"],
                          properties: {
                            event: { const: "ping" },
                            data: { type: "number" },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          put: {
            tags: ["Beta"],
            operationId: "mixedNoDescSplit",
            responses: {
              "200": {
                content: { "application/json": { schema: sharedPure } },
              },
              "204": {},
            },
          },
        },
        "/mixed-with-desc": {
          post: {
            tags: ["Beta"],
            operationId: "mixedWithDescSplit",
            description: "Has description",
            responses: {
              "200": {
                content: { "application/json": { schema: sharedPure } },
              },
              "204": {},
            },
          },
        },
        "/solo-inline-err": {
          get: {
            tags: ["SoloErr"],
            operationId: "noInputWithInlineErr",
            responses: {
              "200": {
                content: { "application/json": { schema: sharedDate } },
              },
              "500": {
                content: { "application/json": { schema: { type: "string" } } },
              },
            },
          },
        },
        "/cycle-schema": {
          get: {
            tags: ["Alpha"],
            operationId: "getCycle",
            responses: {
              "x-meta": "ignored",
              "200": {
                content: { "application/json": { schema: cycA } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          SharedLeaf: sharedLeaf,
          DiamondLeft: diamondLeft,
          DiamondRight: diamondRight,
          SharedDate: sharedDate,
          SharedPure: sharedPure,
          LeafCycle: leafCycle,
          BadNonObjCycle: badNonObjCycle,
          DupWarnCycle: dupWarnCycle,
          BadNonObjCycleRef2: {
            oneOf: [badNonObjCycle, { type: "string" }],
          },
          CycA: cycA,
          CycB: cycB,
          CycC: cycC,
          UnionInCycle: unionInCycle,
          NumEnumOne: { enum: [42] },
          NullOnlyEnum: { enum: [null] },
          NonPrimConst: { const: { nested: true } },
          BadDiscriminator: {
            discriminator: {},
            oneOf: [{ type: "string" }, { type: "number" }],
          },
          BinaryEncoding: { type: "string", contentEncoding: "binary" },
          NoAdditionalProps: { type: "object", additionalProperties: false },
          InferredRec: { additionalProperties: { type: "number" } },
          UnknownType: { type: "mysteryType" },
          TrueItemsArray: { type: "array", items: true },
          RequiredNullableField: {
            type: "object",
            required: [123, "reqNull"],
            properties: {
              reqNull: { type: "string", nullable: true },
              nonObjProp: 123,
            },
          },
          RecInUnionDisc: {
            discriminator: { propertyName: "kind" },
            oneOf: [
              cycA,
              {
                type: "object",
                required: ["kind"],
                properties: { kind: { const: "a" } },
              },
            ],
          },
          DivRecord: {
            type: "object",
            additionalProperties: sharedDate,
          },
          DivIntersect: {
            allOf: [sharedDate, sharedPure],
          },
          AlphaWithPure: {
            type: "object",
            properties: {
              pure: sharedPure,
              tree: cycA,
            },
          },
        },
      },
      definitions: {
        DefUnused: { type: "boolean" },
      },
    };

    const syntheticBundle = lowerOpenApiDocument(syntheticDoc, refMeta, {
      errorStrategy: "union",
      mixed2xxStrategy: "split",
    });
    expect(
      syntheticBundle.diagnostics.filter(
        (d) =>
          d.code === "CLI_UNSUPPORTED_NON_OBJECT_CYCLE" &&
          d.location === "DupWarnCycle",
      ),
    ).toHaveLength(1);

    const jsFiles = [
      ...renderBundleCodeFiles(syntheticBundle, {
        mode: "sync",
        format: "js",
        coreImport: "@defjs/core",
      }),
      ...renderBundleDtsFiles(syntheticBundle, {
        mode: "sync",
        format: "js",
        coreImport: "@defjs/core",
      }),
    ];
    const betaDts = jsFiles.find((f) => f.path === "request/beta.d.ts");
    expect(betaDts?.content).toContain("mixedNoDescSplitNoContent");
    expect(
      jsFiles.find((f) => f.path === "schema/shared.ts")?.content ??
        jsFiles.find((f) => f.path === "schema/shared.js")?.content,
    ).toContain(".nullable()");

    const tsFiles = renderBundleCodeFiles(syntheticBundle, {
      mode: "sync",
      format: "ts",
      coreImport: "@defjs/core",
    });
    expect(
      tsFiles.find((f) => f.path === "schema/alpha.ts")?.content,
    ).toContain("CycA");

    // Direct collectNodeRefIds coverage for record / tuple / discriminatedUnion / intersection / nullable
    const combinedRefs = collectNodeRefIds({
      kind: "nullable",
      inner: {
        kind: "tuple",
        items: [
          { kind: "record", value: { kind: "ref", id: "R1", name: "R1" } },
          {
            kind: "discriminatedUnion",
            tag: "k",
            options: [{ kind: "ref", id: "R2", name: "R2" }],
          },
          {
            kind: "intersection",
            members: [{ kind: "ref", id: "R3", name: "R3" }],
          },
        ],
      },
    });
    expect([...combinedRefs].sort()).toEqual(["R1", "R2", "R3"]);
  });

  test("preserves object properties alongside constraint-only anyOf and oneOf clauses", async () => {
    const tmp = createTempDir("defjs-cli-constraint-union-");
    const outDir = join(tmp, "generated");

    await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "ConstraintUnions", version: "1.0.0" },
          paths: {
            "/schedules/{id}": {
              put: {
                tags: ["Schedules"],
                operationId: "updateSchedule",
                parameters: [
                  {
                    in: "path",
                    name: "id",
                    required: true,
                    schema: { type: "string" },
                  },
                ],
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/UpdateSchedule" },
                    },
                  },
                },
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/NonEmptyPatch" },
                      },
                    },
                  },
                },
              },
            },
          },
          components: {
            schemas: {
              UpdateSchedule: {
                type: "object",
                required: ["id"],
                anyOf: [
                  { required: ["start_time"] },
                  { required: ["duration_minutes"] },
                ],
                properties: {
                  id: { type: "string" },
                  start_time: { type: "string" },
                  duration_minutes: { type: "integer" },
                },
              },
              NonEmptyPatch: {
                type: "object",
                oneOf: [{ minProperties: 1 }, { required: [] }],
                properties: {
                  title: { type: "string" },
                },
              },
              StructuralUnionWithProps: {
                type: "object",
                properties: { kind: { type: "string" } },
                oneOf: [
                  {
                    type: "object",
                    properties: { a: { type: "string" } },
                  },
                  {
                    type: "object",
                    properties: { b: { type: "number" } },
                  },
                ],
              },
              BooleanBranchWithProps: {
                type: "object",
                properties: { raw: { type: "string" } },
                anyOf: [true, { required: ["raw"] }],
              },
            },
          },
        },
        output: { dir: outDir, format: "ts" },
      },
    });

    const schemaCode = readFileSync(
      join(outDir, "schema/schedules.ts"),
      "utf8",
    );
    expect(schemaCode).not.toContain("struct.unknown()");
    expect(schemaCode).toContain("id: /*#__PURE__*/ struct.string()");
    expect(schemaCode).toContain(
      'startTime: /*#__PURE__*/ (/*#__PURE__*/ (/*#__PURE__*/ struct.string()).alias("start_time")).optional()',
    );
    expect(schemaCode).toContain(
      'durationMinutes: /*#__PURE__*/ (/*#__PURE__*/ (/*#__PURE__*/ struct.number()).alias("duration_minutes")).optional()',
    );
    expect(schemaCode).toContain(
      "anyOf required: [start_time] | [duration_minutes]",
    );
    expect(schemaCode).toContain(
      "title: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).optional()",
    );

    const sharedCode = readFileSync(join(outDir, "schema/shared.ts"), "utf8");
    expect(sharedCode).toContain(
      "export const StructuralUnionWithProps = /*#__PURE__*/ struct.or(",
    );
    expect(sharedCode).toContain(
      "export const BooleanBranchWithProps = /*#__PURE__*/ struct.or(",
    );
  });

  test("handles inline objects in recursive composites, alternating cycles, index tags, naming collisions, and enum/nullable types", async () => {
    const tmp = createTempDir("defjs-cli-cycles-names-");
    const outDir = join(tmp, "out");

    const res = await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "CyclesAndNames", version: "1.0.0" },
          paths: {
            "/alt-cycle": {
              get: {
                tags: ["Index"],
                operationId: "defineRequest",
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/AltA" },
                      },
                    },
                  },
                },
              },
            },
            "/index-schemas-tag": {
              get: {
                tags: ["index-schemas"],
                operationId: "appendFormQuery",
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          $ref: "#/components/schemas/IndexSchemasOnly",
                        },
                      },
                    },
                  },
                },
              },
            },
            "/struct-op": {
              post: {
                tags: ["Collisions"],
                operationId: "struct",
                parameters: [
                  {
                    in: "query",
                    name: "q",
                    schema: { type: "string" },
                  },
                ],
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/Infer" },
                      },
                    },
                  },
                },
              },
            },
          },
          components: {
            schemas: {
              AltA: {
                type: "object",
                properties: {
                  b: { $ref: "#/components/schemas/AltB" },
                },
              },
              AltB: {
                type: "object",
                properties: {
                  c: { $ref: "#/components/schemas/AltC" },
                },
              },
              AltC: {
                type: "array",
                items: { $ref: "#/components/schemas/AltA" },
              },
              BadChainHost: {
                type: "object",
                properties: {
                  bad: { $ref: "#/components/schemas/BadSelfArray" },
                },
              },
              BadSelfArray: {
                type: "array",
                items: { $ref: "#/components/schemas/BadSelfArray" },
              },
              BadSelfRecord: {
                type: "object",
                additionalProperties: {
                  $ref: "#/components/schemas/BadSelfRecord",
                },
              },
              RecBase: {
                type: "object",
                properties: { id: { type: "string" } },
              },
              RecAllOf: {
                allOf: [
                  { $ref: "#/components/schemas/RecBase" },
                  {
                    type: "object",
                    properties: {
                      next: { $ref: "#/components/schemas/RecAllOf" },
                    },
                  },
                ],
              },
              RecOneOf: {
                oneOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      next: { $ref: "#/components/schemas/RecOneOf" },
                    },
                  },
                ],
              },
              RecArrayObj: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    parent: { $ref: "#/components/schemas/RecArrayObj" },
                  },
                },
              },
              RecTuple: {
                type: "array",
                prefixItems: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      self: { $ref: "#/components/schemas/RecTuple" },
                    },
                  },
                ],
                items: false,
              },
              RecRecordField: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    back: { $ref: "#/components/schemas/RecRecordField" },
                  },
                },
              },
              RecDiscUnion: {
                discriminator: { propertyName: "kind" },
                oneOf: [
                  {
                    type: "object",
                    required: ["kind"],
                    properties: {
                      kind: { type: "string", const: "leaf" },
                    },
                  },
                  {
                    type: "object",
                    required: ["kind"],
                    properties: {
                      kind: { type: "string", const: "branch" },
                      child: { $ref: "#/components/schemas/RecDiscUnion" },
                    },
                  },
                ],
              },
              IndexSchemasOnly: {
                type: "object",
                properties: { ok: { type: "boolean" } },
              },
              Infer: {
                type: "object",
                properties: {
                  createdAt: { type: "string", format: "date-time" },
                },
              },
              na_n: { type: "string" },
              infinity: { type: "string" },
              Date: { type: "string" },
              Blob: { type: "string" },
              File: { type: "string" },
              Record: { type: "string" },
              NonNullable: { type: "string" },
              DupSingleEnum: { enum: ["a", "a"] },
              DupMultiEnum: { enum: ["a", "a", "b"] },
              DupNumEnum: { enum: [1, 1, 2] },
              NullableUnknown: { nullable: true },
            },
          },
        },
        output: { dir: outDir, format: "js" },
      },
    });

    // AltA -> AltB -> AltC -> AltA must NOT emit CLI_UNSUPPORTED_NON_OBJECT_CYCLE,
    // while BadSelfArray and BadSelfRecord must emit it.
    const cycleDiags = res.diagnostics.filter(
      (d) => d.code === "CLI_UNSUPPORTED_NON_OBJECT_CYCLE",
    );
    expect(cycleDiags.map((d) => d.location).sort()).toEqual([
      "BadSelfArray",
      "BadSelfRecord",
    ]);

    // Tag "Index" must not collide with schema/index barrel, and coexisting "index-schemas" tag stays intact.
    const schemaBarrel = readFileSync(join(outDir, "schema/index.js"), "utf8");
    expect(schemaBarrel).toContain('export * from "./index-schemas.js";');
    expect(schemaBarrel).toContain('export * from "./index-schemas2.js";');
    expect(
      readFileSync(join(outDir, "schema/index-schemas.js"), "utf8"),
    ).toContain("IndexSchemasOnly");
    const indexGroupSchemas = readFileSync(
      join(outDir, "schema/index-schemas2.js"),
      "utf8",
    );
    expect(indexGroupSchemas).toContain("export const AltA");
    expect(indexGroupSchemas.indexOf("export const AltA")).toBeLessThan(
      indexGroupSchemas.indexOf("export const AltC"),
    );

    const sharedCode = readFileSync(join(outDir, "schema/shared.js"), "utf8");
    expect(sharedCode).toContain("export const NaN_ =");
    expect(sharedCode).toContain("export const Infinity_ =");
    expect(sharedCode).toContain("export const Date2 =");
    expect(sharedCode).toContain('struct.literal("a")');
    expect(sharedCode).toContain('struct.enum(["a", "b"])');
    expect(sharedCode).toContain(
      "struct.or(/*#__PURE__*/ struct.literal(1), /*#__PURE__*/ struct.literal(2))",
    );

    const collisionsSchemaCode = readFileSync(
      join(outDir, "schema/collisions.js"),
      "utf8",
    );
    expect(collisionsSchemaCode).toContain("export const Infer2 =");
    const collisionsSchemaDts = readFileSync(
      join(outDir, "schema/collisions.d.ts"),
      "utf8",
    );
    expect(collisionsSchemaDts).toContain(
      "export declare const Infer2: Struct<",
    );
    expect(collisionsSchemaDts).toContain("export type Infer2 =");

    const indexReqCode = readFileSync(join(outDir, "request/index.js"), "utf8");
    expect(indexReqCode).toContain("export const defineRequest2 =");
    const collisionsReqCode = readFileSync(
      join(outDir, "request/collisions.js"),
      "utf8",
    );
    expect(collisionsReqCode).toContain("export const struct =");
    expect(collisionsReqCode).toContain("StructInput2");

    // Importing the generated JS bundle must succeed with zero ReferenceError TDZ crashes!
    const loaded = await loadGeneratedModule(outDir, "index.js");
    expect(loaded.mod["AltA"]).toBeDefined();
    expect(loaded.mod["RecAllOf"]).toBeDefined();
    expect(loaded.mod["RecOneOf"]).toBeDefined();
    expect(loaded.mod["RecArrayObj"]).toBeDefined();
    expect(loaded.mod["RecTuple"]).toBeDefined();
    expect(loaded.mod["RecRecordField"]).toBeDefined();
    expect(loaded.mod["RecDiscUnion"]).toBeDefined();
  });
});
