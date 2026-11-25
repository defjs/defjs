import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { isUnknownFunction } from "../../runtime/diagnostics.ts";
import { generateOpenApi } from "../../index.ts";
import {
  createTempDir,
  getOp,
  loadGeneratedModule,
  startLocalServer,
} from "../../../test/helpers.ts";

describe("@defjs/cli OpenAPI parameter serialization and util emission", () => {
  test("omits util module when operations use only default serialization", async () => {
    const tmp = createTempDir("defjs-cli-query-none-");
    const outDir = join(tmp, "generated");

    const res = await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "DefaultOnly", version: "1.0.0" },
          paths: {
            "/items/{id}": {
              get: {
                tags: ["Alpha"],
                operationId: "getAlphaItem",
                parameters: [
                  {
                    in: "path",
                    name: "id",
                    required: true,
                    schema: { type: "string" },
                  },
                  {
                    in: "header",
                    name: "X-Req-Id",
                    required: false,
                    schema: { type: "string" },
                  },
                  {
                    in: "query",
                    name: "q",
                    required: true,
                    schema: { type: "string" },
                  },
                  {
                    in: "query",
                    name: "tags",
                    schema: { type: "array", items: { type: "string" } },
                  },
                ],
                responses: { "204": { description: "ok" } },
              },
            },
          },
        },
        output: { dir: outDir, format: "ts" },
      },
    });

    expect(res.written).not.toContain("util.ts");
    const alphaCode = readFileSync(join(outDir, "request/alpha.ts"), "utf8");
    expect(alphaCode).not.toContain("../util");
    expect(alphaCode).not.toContain("URLSearchParams");
    expect(alphaCode).not.toContain("_qsValue");
    expect(alphaCode).not.toContain("stringifyQueryValue");
    expect(alphaCode).toContain("path: { id: input.id }");
    expect(alphaCode).toContain("query: input.query");
  });

  test("dynamically emits only needed OpenAPI serializer helpers into util and tracks sync cleanup", async () => {
    const tmp = createTempDir("defjs-cli-openapi-util-");

    // 1. Form-only spec
    const formDir = join(tmp, "form-out");
    const formSpec = {
      openapi: "3.1.0",
      info: { title: "FormOnly", version: "1.0.0" },
      paths: {
        "/form": {
          get: {
            tags: ["Form"],
            operationId: "listForm",
            parameters: [
              {
                in: "query",
                name: "ids",
                required: true,
                style: "form",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "nums",
                style: "form",
                explode: true,
                schema: { type: "array", items: { type: "integer" } },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
      },
    };
    const formRes = await generateOpenApi({
      cwd: tmp,
      target: { input: formSpec, output: { dir: formDir, format: "ts" } },
    });
    expect(formRes.written).toContain("util.ts");
    const formUtil = readFileSync(join(formDir, "util.ts"), "utf8");
    expect(formUtil).toContain("export function appendFormQuery(");
    expect(formUtil).toContain("function appendDelimited(");
    expect(formUtil).toContain("function stringifyParam(");
    expect(formUtil).toContain("function isParamRecord(");
    for (const unused of [
      "appendSpaceDelimitedQuery",
      "appendPipeDelimitedQuery",
      "appendDeepObjectQuery",
      "appendJsonQuery",
      "serializeSimpleParam",
      "serializeLabelParam",
      "serializeMatrixParam",
    ]) {
      expect(formUtil).not.toContain(unused);
    }
    const formReq = readFileSync(join(formDir, "request/form.ts"), "utf8");
    expect(formReq).toContain('import { appendFormQuery } from "../util";');
    expect(formReq).not.toContain("if (q !== undefined)");
    expect(formReq).toContain(
      'appendFormQuery(query, "ids", input.query.ids, false);',
    );
    expect(formReq).toContain(
      'appendFormQuery(query, "nums", input.query.nums);',
    );
    expect(formReq).toContain("return {\n      query,\n    };");

    // 2. DeepObject-only spec omits appendDelimited & form helpers
    const deepDir = join(tmp, "deep-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "DeepOnly", version: "1.0.0" },
          paths: {
            "/deep": {
              get: {
                tags: ["Deep"],
                operationId: "listDeep",
                parameters: [
                  {
                    in: "query",
                    name: "filter",
                    style: "deepObject",
                    explode: true,
                    schema: {
                      type: "object",
                      properties: { min: { type: "number" } },
                    },
                  },
                ],
                responses: { "204": { description: "ok" } },
              },
            },
          },
        },
        output: { dir: deepDir, format: "ts" },
      },
    });
    const deepUtil = readFileSync(join(deepDir, "util.ts"), "utf8");
    expect(deepUtil).toContain("export function appendDeepObjectQuery(");
    expect(deepUtil).toContain("function stringifyParam(");
    expect(deepUtil).toContain("function isParamRecord(");
    expect(deepUtil).not.toContain("appendDelimited");
    expect(deepUtil).not.toContain("appendFormQuery");

    // 3. JSON-content query-only spec omits stringifyParam & isParamRecord
    const jsonDir = join(tmp, "json-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "JsonQueryOnly", version: "1.0.0" },
          paths: {
            "/json-query": {
              get: {
                tags: ["Json"],
                operationId: "listJson",
                parameters: [
                  {
                    in: "query",
                    name: "filter",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: { min: { type: "number" } },
                        },
                      },
                    },
                  },
                ],
                responses: { "204": { description: "ok" } },
              },
            },
          },
        },
        output: { dir: jsonDir, format: "ts" },
      },
    });
    const jsonUtil = readFileSync(join(jsonDir, "util.ts"), "utf8");
    expect(jsonUtil).toContain("export function appendJsonQuery(");
    expect(jsonUtil).not.toContain("stringifyParam");
    expect(jsonUtil).not.toContain("isParamRecord");
    expect(jsonUtil).not.toContain("appendFormQuery");

    // 4. Path/header-only spec omits all append*Query helpers
    const pathHeaderDir = join(tmp, "ph-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "PathHeaderOnly", version: "1.0.0" },
          paths: {
            "/items/{ids}/{label}/{matrix}": {
              get: {
                tags: ["PH"],
                operationId: "getPH",
                parameters: [
                  {
                    in: "path",
                    name: "ids",
                    required: true,
                    style: "simple",
                    schema: { type: "array", items: { type: "string" } },
                  },
                  {
                    in: "path",
                    name: "label",
                    required: true,
                    style: "label",
                    explode: true,
                    schema: { type: "string" },
                  },
                  {
                    in: "path",
                    name: "matrix",
                    required: true,
                    style: "matrix",
                    schema: {
                      type: "object",
                      properties: { a: { type: "string" } },
                    },
                  },
                ],
                responses: { "204": { description: "ok" } },
              },
            },
          },
        },
        output: { dir: pathHeaderDir, format: "ts" },
      },
    });
    const phUtil = readFileSync(join(pathHeaderDir, "util.ts"), "utf8");
    expect(phUtil).toContain("export function serializeSimpleParam(");
    expect(phUtil).toContain("export function serializeLabelParam(");
    expect(phUtil).toContain("export function serializeMatrixParam(");
    expect(phUtil).toContain("function stringifyParam(");
    expect(phUtil).toContain("function isParamRecord(");
    expect(phUtil).not.toContain("appendFormQuery");
    expect(phUtil).not.toContain("appendDelimited");

    // 5. Multi-group per-file imports + JS/MJS d.ts + sync cleanup
    const multiSpec = {
      openapi: "3.1.0",
      info: { title: "MultiGroup", version: "1.0.0" },
      paths: {
        "/a": {
          get: {
            tags: ["GroupA"],
            operationId: "opA",
            parameters: [
              {
                in: "query",
                name: "filter",
                style: "deepObject",
                explode: true,
                schema: {
                  type: "object",
                  properties: { k: { type: "string" } },
                },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/b": {
          get: {
            tags: ["GroupB"],
            operationId: "opB",
            parameters: [
              {
                in: "query",
                name: "pipe",
                style: "pipeDelimited",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "space",
                style: "spaceDelimited",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/c": {
          get: {
            tags: ["GroupC"],
            operationId: "opC",
            parameters: [
              { in: "query", name: "q", schema: { type: "string" } },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
      },
    };

    const multiTsDir = join(tmp, "multi-ts");
    await generateOpenApi({
      cwd: tmp,
      target: { input: multiSpec, output: { dir: multiTsDir, format: "ts" } },
    });
    expect(readFileSync(join(multiTsDir, "index.ts"), "utf8")).not.toContain(
      "./util",
    );
    expect(
      readFileSync(join(multiTsDir, "request/group-a.ts"), "utf8"),
    ).toContain('import { appendDeepObjectQuery } from "../util";');
    expect(
      readFileSync(join(multiTsDir, "request/group-b.ts"), "utf8"),
    ).toContain(
      'import { appendPipeDelimitedQuery, appendSpaceDelimitedQuery } from "../util";',
    );
    expect(
      readFileSync(join(multiTsDir, "request/group-c.ts"), "utf8"),
    ).not.toContain("../util");

    const jsDir = join(tmp, "multi-js");
    const jsRes = await generateOpenApi({
      cwd: tmp,
      target: { input: multiSpec, output: { dir: jsDir, format: "js" } },
    });
    expect(jsRes.written).toContain("util.js");
    expect(jsRes.written).toContain("util.d.ts");
    const utilJs = readFileSync(join(jsDir, "util.js"), "utf8");
    expect(utilJs).toContain("export function appendDeepObjectQuery(");
    expect(utilJs).toContain("export function appendPipeDelimitedQuery(");
    expect(utilJs).toContain("export function appendSpaceDelimitedQuery(");
    expect(utilJs).not.toContain("appendFormQuery");
    const utilDts = readFileSync(join(jsDir, "util.d.ts"), "utf8");
    expect(utilDts).toContain(
      "export declare function appendDeepObjectQuery(params: URLSearchParams, name: string, value: unknown): void;",
    );
    expect(utilDts).toContain(
      "export declare function appendPipeDelimitedQuery(params: URLSearchParams, name: string, value: unknown, explode?: boolean): void;",
    );
    expect(utilDts).toContain(
      "export declare function appendSpaceDelimitedQuery(params: URLSearchParams, name: string, value: unknown, explode?: boolean): void;",
    );
    expect(utilDts).not.toContain("appendFormQuery");
    expect(readFileSync(join(jsDir, "request/group-b.js"), "utf8")).toContain(
      'import { appendPipeDelimitedQuery, appendSpaceDelimitedQuery } from "../util.js";',
    );

    const mjsDir = join(tmp, "multi-mjs");
    const mjsRes = await generateOpenApi({
      cwd: tmp,
      target: { input: multiSpec, output: { dir: mjsDir, format: "mjs" } },
    });
    expect(mjsRes.written).toContain("util.mjs");
    expect(mjsRes.written).toContain("util.d.mts");
    expect(readFileSync(join(mjsDir, "request/group-b.mjs"), "utf8")).toContain(
      'import { appendPipeDelimitedQuery, appendSpaceDelimitedQuery } from "../util.mjs";',
    );

    // Sync cleanup deletes util.ts when simplified spec no longer needs it
    const syncRes = await generateOpenApi({
      cwd: tmp,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "Simplified", version: "1.0.0" },
          paths: {
            "/c": {
              get: {
                tags: ["GroupC"],
                operationId: "opC",
                parameters: [
                  { in: "query", name: "q", schema: { type: "string" } },
                ],
                responses: { "204": { description: "ok" } },
              },
            },
          },
        },
        output: { dir: multiTsDir, format: "ts" },
        mode: "sync",
      },
    });
    expect(syncRes.deleted).toContain("util.ts");
  });

  test("executes full OpenAPI parameter serialization styles (query, path, header, content) against real HTTP server", async () => {
    const tmp = createTempDir("defjs-cli-param-e2e-");
    const observed: {
      url: string;
      headers: { [key: string]: string | string[] | undefined };
    }[] = [];

    const baseUrl = await startLocalServer((req) => {
      observed.push({ url: req.url, headers: req.headers });
      return Promise.resolve({ status: 204 });
    });

    const spec = {
      openapi: "3.1.0",
      info: { title: "OpenApiSerializationE2E", version: "1.0.0" },
      paths: {
        "/query-matrix": {
          get: {
            tags: ["Params"],
            operationId: "testQueryMatrix",
            parameters: [
              {
                in: "query",
                name: "form_csv",
                style: "form",
                explode: false,
                schema: { type: "array", items: { type: ["string", "null"] } },
              },
              {
                in: "query",
                name: "form_obj_csv",
                style: "form",
                explode: false,
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    firstName: { type: "string" },
                    skip: { type: ["string", "null"] },
                  },
                },
              },
              {
                in: "query",
                name: "form_obj_ex",
                style: "form",
                explode: true,
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    firstName: { type: "string" },
                  },
                },
              },
              {
                in: "query",
                name: "empty_arr",
                style: "form",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "empty_str",
                style: "form",
                explode: false,
                schema: { type: "string" },
              },
              {
                in: "query",
                name: "date_param",
                style: "form",
                explode: false,
                schema: { type: "string", format: "date-time" },
              },
              {
                in: "query",
                name: "flag_param",
                style: "form",
                explode: false,
                schema: { type: "boolean" },
              },
              {
                in: "query",
                name: "sd_arr",
                style: "spaceDelimited",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "sd_obj",
                style: "spaceDelimited",
                explode: false,
                schema: {
                  type: "object",
                  properties: { k: { type: "number" } },
                },
              },
              {
                in: "query",
                name: "sd_arr_ex",
                style: "spaceDelimited",
                explode: true,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "pd_arr",
                style: "pipeDelimited",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "pd_obj",
                style: "pipeDelimited",
                explode: false,
                schema: {
                  type: "object",
                  properties: { k: { type: "number" } },
                },
              },
              {
                in: "query",
                name: "pd_arr_ex",
                style: "pipeDelimited",
                explode: true,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "query",
                name: "deep_filter",
                style: "deepObject",
                explode: true,
                schema: {
                  type: "object",
                  properties: {
                    range: {
                      type: "object",
                      properties: { min: { type: "number" } },
                    },
                    tags: { type: "array", items: { type: "string" } },
                    since: { type: "string", format: "date-time" },
                    skipped: { type: ["string", "null"] },
                  },
                },
              },
              {
                in: "query",
                name: "json_q",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { active: { type: "boolean" } },
                    },
                  },
                },
              },
              {
                in: "query",
                name: "text_q",
                content: {
                  "text/plain": { schema: { type: "string" } },
                },
              },
              {
                in: "query",
                name: "json_any_q",
                content: {
                  "application/json": {},
                },
              },
              {
                in: "query",
                name: "text_empty_content",
                content: {
                  "text/plain": {},
                },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/headers-optional-only": {
          get: {
            tags: ["Params"],
            operationId: "testOptionalHeaderOnly",
            parameters: [
              {
                in: "header",
                name: "X-Opt-List",
                required: false,
                schema: { type: "array", items: { type: "string" } },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/form-object-only": {
          get: {
            tags: ["Params"],
            operationId: "testFormObjectOnly",
            parameters: [
              {
                in: "query",
                name: "filter",
                style: "form",
                explode: true,
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    firstName: { type: "string" },
                  },
                },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/paths/{simple_arr}/{simple_obj}/{label_prim}/{label_arr}/{label_obj}/{matrix_prim}/{matrix_empty}/{matrix_arr}/{matrix_empty_arr}/{user_id}/{matrix_obj_ex}/{matrix_empty_obj}/{json_path}":
          {
            get: {
              tags: ["Params"],
              operationId: "testPathStyles",
              parameters: [
                {
                  in: "path",
                  name: "simple_arr",
                  required: true,
                  style: "simple",
                  schema: { type: "array", items: { type: "number" } },
                },
                {
                  in: "path",
                  name: "simple_obj",
                  required: true,
                  style: "simple",
                  explode: true,
                  schema: {
                    type: "object",
                    properties: {
                      role: { type: "string" },
                      firstName: { type: "string" },
                    },
                  },
                },
                {
                  in: "path",
                  name: "label_prim",
                  required: true,
                  style: "label",
                  schema: { type: "number" },
                },
                {
                  in: "path",
                  name: "label_arr",
                  required: true,
                  style: "label",
                  explode: true,
                  schema: { type: "array", items: { type: "number" } },
                },
                {
                  in: "path",
                  name: "label_obj",
                  required: true,
                  style: "label",
                  explode: false,
                  schema: {
                    type: "object",
                    properties: {
                      role: { type: "string" },
                      firstName: { type: "string" },
                    },
                  },
                },
                {
                  in: "path",
                  name: "matrix_prim",
                  required: true,
                  style: "matrix",
                  schema: { type: "number" },
                },
                {
                  in: "path",
                  name: "matrix_empty",
                  required: true,
                  style: "matrix",
                  schema: { type: "string" },
                },
                {
                  in: "path",
                  name: "matrix_arr",
                  required: true,
                  style: "matrix",
                  explode: true,
                  schema: { type: "array", items: { type: "number" } },
                },
                {
                  in: "path",
                  name: "matrix_empty_arr",
                  required: true,
                  style: "matrix",
                  schema: { type: "array", items: { type: "string" } },
                },
                {
                  in: "path",
                  name: "user_id",
                  required: true,
                  style: "matrix",
                  explode: false,
                  schema: { type: "number" },
                },
                {
                  in: "path",
                  name: "matrix_obj_ex",
                  required: true,
                  style: "matrix",
                  explode: true,
                  schema: {
                    type: "object",
                    properties: {
                      role: { type: "string" },
                      firstName: { type: "string" },
                    },
                  },
                },
                {
                  in: "path",
                  name: "matrix_empty_obj",
                  required: true,
                  style: "matrix",
                  schema: {
                    type: "object",
                    properties: { k: { type: "string" } },
                  },
                },
                {
                  in: "path",
                  name: "json_path",
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { id: { type: "number" } },
                      },
                    },
                  },
                },
              ],
              responses: { "204": { description: "ok" } },
            },
          },
        "/headers-required": {
          get: {
            tags: ["Params"],
            operationId: "testRequiredHeaders",
            parameters: [
              {
                in: "header",
                name: "X-Req-Simple",
                required: true,
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "header",
                name: "X-Req-Null-Json",
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: ["object", "null"],
                      properties: { a: { type: "string" } },
                    },
                  },
                },
              },
              {
                in: "header",
                name: "X-Opt-Obj",
                required: false,
                explode: true,
                schema: {
                  type: "object",
                  properties: { role: { type: "string" } },
                },
              },
              {
                in: "header",
                name: "X-Opt-Null-Arr",
                required: false,
                schema: {
                  type: ["array", "null"],
                  items: { type: "string" },
                },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/headers-optional-json": {
          get: {
            tags: ["Params"],
            operationId: "testOptionalHeadersWithQuery",
            parameters: [
              {
                in: "query",
                name: "items",
                style: "form",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
              {
                in: "header",
                name: "X-Meta-Json",
                required: false,
                content: {
                  "application/json": {
                    schema: {
                      type: ["object", "null"],
                      properties: { k: { type: "string" } },
                    },
                  },
                },
              },
              {
                in: "header",
                name: "X-Plain-Hdr",
                required: false,
                schema: { type: "string" },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
      },
    };

    for (const format of ["ts", "mjs"] as const) {
      const outDir = join(tmp, `e2e-${format}`);
      await generateOpenApi({
        cwd: tmp,
        target: { input: spec, output: { dir: outDir, format } },
      });

      const entryExt = format === "mjs" ? ".mjs" : ".ts";
      const bundle = await loadGeneratedModule(outDir, `index${entryExt}`);
      const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));

      const testQueryMatrix = getOp(bundle.mod, "testQueryMatrix");
      const [qErr] = await testQueryMatrix(client, {
        query: {
          formCsv: ["a", null, "b"],
          formObjCsv: { role: "admin", firstName: "Alex", skip: null },
          formObjEx: { role: "admin", firstName: "Alex" },
          emptyArr: [],
          emptyStr: "",
          dateParam: new Date("2026-03-04T05:06:07.000Z"),
          flagParam: true,
          sdArr: ["x", "y"],
          sdObj: { k: 9 },
          sdArrEx: ["s1", "s2"],
          pdArr: ["p", "q"],
          pdObj: { k: 8 },
          pdArrEx: ["p1", "p2"],
          deepFilter: {
            range: { min: 1 },
            tags: ["t0", "t1"],
            since: new Date("2026-03-04T05:06:07.000Z"),
            skipped: null,
          },
          jsonQ: { active: true },
          textQ: "raw-text",
        },
      });
      expect(qErr).toBeNull();
      const qUrl = observed.at(-1)?.url ?? "";
      const qParams = new URLSearchParams(qUrl.split("?")[1] ?? "");
      expect(qParams.get("form_csv")).toBe("a,b");
      expect(qParams.get("form_obj_csv")).toBe("role,admin,firstName,Alex");
      expect(qParams.getAll("role")).toContain("admin");
      expect(qParams.getAll("firstName")).toContain("Alex");
      expect(qParams.has("empty_arr")).toBe(false);
      expect(qParams.get("empty_str")).toBe("");
      expect(qParams.get("date_param")).toBe("2026-03-04T05:06:07.000Z");
      expect(qParams.get("flag_param")).toBe("true");
      expect(qParams.get("sd_arr")).toBe("x y");
      expect(qParams.get("sd_obj")).toBe("k 9");
      expect(qParams.getAll("sd_arr_ex")).toEqual(["s1", "s2"]);
      expect(qParams.get("pd_arr")).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe("k|8");
      expect(qParams.getAll("pd_arr_ex")).toEqual(["p1", "p2"]);
      expect(qParams.get("deep_filter[range][min]")).toBe("1");
      expect(qParams.get("deep_filter[tags][0]")).toBe("t0");
      expect(qParams.get("deep_filter[tags][1]")).toBe("t1");
      expect(qParams.get("deep_filter[since]")).toBe(
        "2026-03-04T05:06:07.000Z",
      );
      expect(qParams.has("deep_filter[skipped]")).toBe(false);
      expect(qParams.get("json_q")).toBe('{"active":true}');
      expect(qParams.get("text_q")).toBe("raw-text");

      const testFormObjectOnly = getOp(bundle.mod, "testFormObjectOnly");
      const [foErr] = await testFormObjectOnly(client, {
        query: { filter: { role: "admin", firstName: "Alex" } },
      });
      expect(foErr).toBeNull();
      const foUrl = observed.at(-1)?.url ?? "";
      expect(foUrl).toContain("role=admin");
      expect(foUrl).toContain("firstName=Alex");

      const testPathStyles = getOp(bundle.mod, "testPathStyles");
      const [pErr] = await testPathStyles(client, {
        simpleArr: [3, 4, 5],
        simpleObj: { role: "admin", firstName: "Alex" },
        labelPrim: 5,
        labelArr: [3, 4, 5],
        labelObj: { role: "admin", firstName: "Alex" },
        matrixPrim: 5,
        matrixEmpty: "",
        matrixArr: [3, 4, 5],
        matrixEmptyArr: [],
        userId: 42,
        matrixObjEx: { role: "admin", firstName: "Alex" },
        matrixEmptyObj: {},
        jsonPath: { id: 9 },
      });
      expect(pErr).toBeNull();
      const pSegs = (observed.at(-1)?.url ?? "")
        .replace(/^\/paths\//, "")
        .split("/")
        .map(decodeURIComponent);
      expect(pSegs).toEqual([
        "3,4,5",
        "role=admin,firstName=Alex",
        ".5",
        ".3.4.5",
        ".role,admin,firstName,Alex",
        ";matrix_prim=5",
        ";matrix_empty",
        ";matrix_arr=3;matrix_arr=4;matrix_arr=5",
        ";matrix_empty_arr",
        ";user_id=42",
        ";role=admin;firstName=Alex",
        ";matrix_empty_obj",
        '{"id":9}',
      ]);

      const testRequiredHeaders = getOp(bundle.mod, "testRequiredHeaders");
      const [h1Err] = await testRequiredHeaders(client, {
        headers: {
          xReqSimple: ["h1", "h2"],
          xReqNullJson: null,
          xOptObj: { role: "admin" },
          xOptNullArr: null,
        },
      });
      expect(h1Err).toBeNull();
      expect(observed.at(-1)?.headers["x-req-simple"]).toBe("h1,h2");
      expect(observed.at(-1)?.headers["x-req-null-json"]).toBeUndefined();
      expect(observed.at(-1)?.headers["x-opt-obj"]).toBe("role=admin");
      expect(observed.at(-1)?.headers["x-opt-null-arr"]).toBeUndefined();

      const [h2Err] = await testRequiredHeaders(client, {
        headers: {
          xReqSimple: ["h3"],
          xReqNullJson: { a: "ok" },
          xOptNullArr: ["n1", "n2"],
        },
      });
      expect(h2Err).toBeNull();
      expect(observed.at(-1)?.headers["x-req-null-json"]).toBe('{"a":"ok"}');
      expect(observed.at(-1)?.headers["x-opt-null-arr"]).toBe("n1,n2");
      expect(observed.at(-1)?.headers["x-opt-obj"]).toBeUndefined();

      const testOptionalHeadersWithQuery = getOp(
        bundle.mod,
        "testOptionalHeadersWithQuery",
      );
      const [oh1Err] = await testOptionalHeadersWithQuery(client, {
        query: { items: ["i1", "i2"] },
        headers: { xMetaJson: { k: "v" }, xPlainHdr: "plain" },
      });
      expect(oh1Err).toBeNull();
      expect(observed.at(-1)?.headers["x-meta-json"]).toBe('{"k":"v"}');
      expect(observed.at(-1)?.headers["x-plain-hdr"]).toBe("plain");

      const [oh2Err] = await testOptionalHeadersWithQuery(client, {});
      expect(oh2Err).toBeNull();
      expect(observed.at(-1)?.headers["x-meta-json"]).toBeUndefined();

      const testOptionalHeaderOnly = getOp(
        bundle.mod,
        "testOptionalHeaderOnly",
      );
      const [hoErr] = await testOptionalHeaderOnly(client, {
        headers: { xOptList: ["a", "b"] },
      });
      expect(hoErr).toBeNull();
      expect(observed.at(-1)?.headers["x-opt-list"]).toBe("a,b");
    }
  });

  test("routes non-core form+explode queries through appendFormQuery and handles stringifyParam fallbacks", async () => {
    const tmp = createTempDir("defjs-cli-form-explode-");
    const observedUrls: string[] = [];
    const baseUrl = await startLocalServer((req) => {
      observedUrls.push(req.url);
      return Promise.resolve({ status: 204 });
    });

    const spec = {
      openapi: "3.1.0",
      info: { title: "FormExplodeVariants", version: "1.0.0" },
      components: {
        schemas: {
          ScalarTag: {
            type: "string",
          },
          TagList: {
            type: "array",
            items: { type: "string" },
          },
          FilterObj: {
            type: "object",
            properties: {
              role: { type: "string" },
              count: { type: "integer" },
            },
          },
        },
      },
      paths: {
        "/scalar-form-only": {
          get: {
            tags: ["ScalarOnly"],
            operationId: "testScalarFormOnly",
            parameters: [
              {
                in: "query",
                name: "scalarUnion",
                schema: {
                  oneOf: [{ type: "string" }, { type: "integer" }],
                },
              },
              {
                in: "query",
                name: "arrScalarUnion",
                schema: {
                  type: "array",
                  items: {
                    oneOf: [{ type: "string" }, { type: "integer" }],
                  },
                },
              },
              {
                in: "query",
                name: "tagRef",
                schema: { $ref: "#/components/schemas/TagList" },
              },
              {
                in: "query",
                name: "scalarRefArr",
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ScalarTag" },
                },
              },
              {
                in: "query",
                name: "scalarTuple",
                schema: {
                  type: "array",
                  prefixItems: [{ type: "string" }, { type: "integer" }],
                },
              },
              {
                in: "query",
                name: "constVer",
                schema: { const: "v1" },
              },
              {
                in: "query",
                name: "modeEnum",
                schema: { type: "string", enum: ["fast", "safe"] },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/binary-form": {
          get: {
            tags: ["BinaryOnly"],
            operationId: "testBinaryFormQuery",
            parameters: [
              {
                in: "query",
                name: "payload",
                schema: { type: "string", format: "binary" },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/null-const-form": {
          get: {
            tags: ["NullConstOnly"],
            operationId: "testNullConstFormQuery",
            parameters: [
              {
                in: "query",
                name: "emptyMarker",
                schema: { const: null },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/form-exploded-variants": {
          get: {
            tags: ["Complex"],
            operationId: "testFormExplodedVariants",
            parameters: [
              {
                in: "query",
                name: "arrObj",
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/FilterObj" },
                },
              },
              {
                in: "query",
                name: "tupleObj",
                schema: {
                  type: "array",
                  prefixItems: [
                    {
                      type: "object",
                      properties: { k: { type: "string" } },
                    },
                  ],
                },
              },
              {
                in: "query",
                name: "mixedUnion",
                schema: {
                  oneOf: [
                    { type: "string" },
                    { $ref: "#/components/schemas/FilterObj" },
                  ],
                },
              },
              {
                in: "query",
                name: "nullableStr",
                schema: { type: ["string", "null"] },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/simple-path/{item}": {
          get: {
            tags: ["Complex"],
            operationId: "testSimplePathObj",
            parameters: [
              {
                in: "path",
                name: "item",
                required: true,
                style: "simple",
                schema: { $ref: "#/components/schemas/FilterObj" },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
      },
    };

    const outDir = join(tmp, "generated");
    await generateOpenApi({
      cwd: tmp,
      target: { input: spec, output: { dir: outDir, format: "ts" } },
    });

    expect(
      readFileSync(join(outDir, "request/scalar-only.ts"), "utf8"),
    ).not.toContain("appendFormQuery");
    expect(
      readFileSync(join(outDir, "request/binary-only.ts"), "utf8"),
    ).toContain("appendFormQuery");
    expect(
      readFileSync(join(outDir, "request/null-const-only.ts"), "utf8"),
    ).toContain("appendFormQuery");
    expect(readFileSync(join(outDir, "request/complex.ts"), "utf8")).toContain(
      "appendFormQuery",
    );

    const bundle = await loadGeneratedModule(outDir, "index.ts");
    const utilBundle = await loadGeneratedModule(outDir, "util.ts");
    const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));

    const testFormExplodedVariants = getOp(
      bundle.mod,
      "testFormExplodedVariants",
    );
    const [varErr] = await testFormExplodedVariants(client, {
      query: {
        arrObj: [{ role: "admin" }, { count: 2 }],
        tupleObj: [{ k: "v" }],
        mixedUnion: { role: "guest" },
        nullableStr: null,
      },
    });
    expect(varErr).toBeNull();
    const qs = new URL(observedUrls.at(-1) ?? "/", "http://local").searchParams;
    expect(qs.getAll("arrObj")).toEqual(['{"role":"admin"}', '{"count":2}']);
    expect(qs.getAll("tupleObj")).toEqual(['{"k":"v"}']);
    expect(qs.get("role")).toBe("guest");
    expect(qs.has("nullableStr")).toBe(false);

    const serializeSimpleParam = utilBundle.mod["serializeSimpleParam"];
    expect(isUnknownFunction(serializeSimpleParam)).toBe(true);
    if (isUnknownFunction(serializeSimpleParam)) {
      expect(serializeSimpleParam(undefined)).toBe("");
      expect(serializeSimpleParam(() => 1)).toBe("");
      expect(serializeSimpleParam(Symbol("s"))).toBe("");
      expect(serializeSimpleParam(42)).toBe("42");
      expect(serializeSimpleParam(true)).toBe("true");
    }
  });
});
