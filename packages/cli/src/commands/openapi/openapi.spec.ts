import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateOpenApi } from "../../index.ts";
import { CliError } from "../../runtime/diagnostics.ts";
import {
  createTempDir,
  getOp,
  isAsyncIterable,
  loadGeneratedModule,
  startLocalServer,
} from "../../../test/helpers.ts";
import {
  OPENAPI_UTIL_CATALOG,
  renderOpenApiUtilCode,
  resolveUtilFunctionClosure,
} from "./emitter/util_helpers.ts";
import {
  formatErrorLocation,
  recordDereferencedRefMeta,
  resolveSchemaRefMeta,
  toDiagnostics,
} from "./parser/scalar.ts";

describe("@defjs/cli OpenAPI command, parser, and E2E", () => {
  test("scalar parser helpers handle edge inputs and dereferenced ref metadata", () => {
    expect(formatErrorLocation("paths./a")).toBe("paths./a");
    expect(formatErrorLocation(["paths", "/a"])).toBe("paths./a");
    expect(formatErrorLocation("")).toBeUndefined();
    expect(resolveSchemaRefMeta("")).toBeUndefined();
    expect(resolveSchemaRefMeta("#/")).toBeUndefined();
    expect(resolveSchemaRefMeta("./folder/plain")).toEqual({
      key: "./folder/plain",
      name: "plain",
    });
    expect(
      toDiagnostics(
        [
          { code: "EXT_ERR", path: ["paths", "/x"], message: "bad ref" },
          { message: "missing path" },
        ],
        "FALLBACK",
      ),
    ).toEqual([
      {
        code: "EXT_ERR",
        severity: "error",
        message: "bad ref",
        location: "paths./x",
      },
      { code: "FALLBACK", severity: "error", message: "missing path" },
    ]);

    const refMetaMap = new WeakMap<
      object,
      { readonly key: string; readonly name: string }
    >();
    const trackedSchema = { type: "string" };
    recordDereferencedRefMeta(refMetaMap, { ref: "#", schema: {} });
    expect(refMetaMap.has(trackedSchema)).toBe(false);
    recordDereferencedRefMeta(refMetaMap, {
      ref: "#/components/schemas/Foo",
      resolved: null,
      schema: trackedSchema,
    });
    expect(refMetaMap.get(trackedSchema)).toEqual({
      key: "#/components/schemas/Foo",
      name: "Foo",
    });
    recordDereferencedRefMeta(refMetaMap, {
      ref: "#/components/schemas/Bar",
      resolved: trackedSchema,
      schema: trackedSchema,
    });
    expect(refMetaMap.get(trackedSchema)?.name).toBe("Foo");
  });

  test("loads .ts OpenAPI input, async loader, remote URL, and multi-file $ref", async () => {
    const tmp = createTempDir("defjs-cli-inputs-");

    // 1. Local .ts input module
    writeFileSync(
      join(tmp, "api.ts"),
      `export default {
  openapi: "3.1.0",
  info: { title: "TS Input", version: "1.0.0" },
  paths: {},
};
`,
    );
    const tsOut = await generateOpenApi({
      cwd: tmp,
      target: {
        input: "./api.ts",
        output: { dir: "./out-ts" },
      },
    });
    expect(tsOut.operationCount).toBe(0);
    expect(readFileSync(join(tmp, "out-ts/index.ts"), "utf8")).toContain(
      "export {};",
    );

    // Bad non-object export in .ts input module
    writeFileSync(join(tmp, "bad-spec.ts"), "export default 123;\n");
    await expect(
      generateOpenApi({
        cwd: tmp,
        target: { input: "./bad-spec.ts", output: { dir: "./out-bad" } },
      }),
    ).rejects.toThrow(
      "must default-export a document object or YAML/JSON string",
    );

    // 2. Async loader function returning string and object, plus non-object empty input "[]"
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: () =>
          Promise.resolve(
            `openapi: 3.1.0\ninfo:\n  title: Async\n  version: "1.0"\npaths: {}`,
          ),
        output: { dir: "./out-async", format: "js" },
      },
    });
    expect(existsSync(join(tmp, "out-async/index.d.ts"))).toBe(true);

    await generateOpenApi({
      cwd: tmp,
      target: {
        input: () => ({
          openapi: "3.1.0",
          info: { title: "AsyncObj", version: "1.0.0" },
          paths: {},
        }),
        output: { dir: "./out-async-obj" },
      },
    });

    await expect(
      generateOpenApi({
        cwd: tmp,
        target: { input: "[]", output: { dir: "./out-err" } },
      }),
    ).rejects.toThrow(CliError);

    // Non-extension inline path-like YAML still falls back cleanly
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: `openapi: "3.1.0"\ninfo: { title: InlineSingleLine, version: "1.0" }\npaths: {}`,
        output: { dir: "./out-inline" },
      },
    });

    // 3. Remote URL via injected fetch
    const remoteSpec = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Remote", version: "1.0.0" },
      paths: {},
    });
    const urlOut = await generateOpenApi({
      cwd: tmp,
      fetch: () =>
        Promise.resolve(
          new Response(remoteSpec, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      target: {
        input: "https://example.invalid/openapi.json",
        output: { dir: "./out-url" },
      },
    });
    expect(urlOut.operationCount).toBe(0);

    // 4. Multi-file YAML external $ref + escaped pointer ~1
    mkdirSync(join(tmp, "models"));
    writeFileSync(
      join(tmp, "models/item_entry.yaml"),
      `type: object
required: [id]
properties:
  id: { type: string }
  note: { type: string, nullable: true }
`,
    );
    writeFileSync(
      join(tmp, "multi.yaml"),
      `openapi: 3.0.3
info: { title: Multi, version: "1.0" }
paths:
  /items:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./models/item_entry.yaml"
`,
    );
    const multiOut = await generateOpenApi({
      cwd: tmp,
      target: { input: "./multi.yaml", output: { dir: "./out-multi" } },
    });
    expect(multiOut.schemaCount).toBe(1);
    expect(multiOut.written).toContain("schema/default.ts");

    // 5. Missing file & invalid OpenAPI & load throw errors
    await expect(
      generateOpenApi({
        cwd: tmp,
        target: { input: "./missing.yaml", output: { dir: "./out-err" } },
      }),
    ).rejects.toThrow("OpenAPI input file not found");

    await expect(
      generateOpenApi({
        cwd: tmp,
        target: { input: "   ", output: { dir: "./out-err" } },
      }),
    ).rejects.toThrow("must not be empty");

    await expect(
      generateOpenApi({
        cwd: tmp,
        fetch: () => Promise.reject(new Error("network down")),
        target: {
          input: "https://example.invalid/broken.json",
          output: { dir: "./out-err" },
        },
      }),
    ).rejects.toThrow(CliError);

    await expect(
      generateOpenApi({
        cwd: tmp,
        target: {
          input: { openapi: "3.1.0", info: { title: "Broken" } },
          output: { dir: "./out-err" },
        },
      }),
    ).rejects.toThrow("Invalid OpenAPI specification");

    writeFileSync(
      join(tmp, "broken-ref.yaml"),
      `openapi: 3.1.0
info: { title: BrokenRef, version: "1.0" }
paths:
  /x:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./nonexistent-subfile.yaml"
`,
    );
    await expect(
      generateOpenApi({
        cwd: tmp,
        target: { input: "./broken-ref.yaml", output: { dir: "./out-err" } },
      }),
    ).rejects.toThrow(CliError);
  });

  test("executes Swagger 2.0, OpenAPI 3.0/3.1/3.2 (aliases, custom query, forms, binary, SSE, errors) against real HTTP server", async () => {
    const tmp = createTempDir("defjs-cli-e2e-");
    const observed: {
      url: string;
      method: string;
      headers: { [key: string]: string | string[] | undefined };
      bodyText: string;
    }[] = [];

    const baseUrl = await startLocalServer((req) => {
      observed.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        bodyText: req.body.toString("utf8"),
      });

      if (req.url.startsWith("/orders/") && req.method === "POST") {
        if (req.url.includes("fail")) {
          return Promise.resolve({
            status: 404,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              code: "NOT_FOUND",
              message: "Missing order",
            }),
          });
        }
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: req.body.toString("utf8"),
        });
      }
      if (req.url.startsWith("/query-styles")) {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true }),
        });
      }
      if (req.url === "/form") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "form-ok",
        });
      }
      if (req.url === "/upload") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.from([1, 2, 3]),
        });
      }
      if (req.url === "/events") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          sseChunks: [
            'event: progress\ndata: {"pct":50}\n\n',
            "event: done\ndata: ok\n\n",
          ],
        });
      }
      if (req.url === "/tree-groups") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify([{ name: "root", items: [{ name: "leaf" }] }]),
        });
      }
      if (req.url === "/pets" && req.method === "POST") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: req.body.toString("utf8"),
        });
      }
      return Promise.resolve({ status: 204 });
    });

    const spec = `openapi: 3.2.0
info:
  title: Full Feature API
  version: 1.0.0
webhooks:
  orderUpdated:
    post:
      responses:
        "200": { description: ok }
paths:
  /orders/{order_id}:
    parameters:
      - in: cookie
        name: session_id
        schema: { type: string }
    post:
      tags: [Orders]
      summary: Update order
      description: |
        Multi-line description with */ comment terminator.
      operationId: updateOrder
      parameters:
        - in: path
          name: order_id
          required: true
          schema: { type: string, minLength: 2, format: uuid }
        - in: header
          name: X-Request-Id
          required: false
          schema: { type: string, nullable: true }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/OrderPayload"
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/OrderPayload"
        "400":
          description: bad
          content:
            application/json:
              schema:
                type: object
                required: [code]
                properties:
                  code: { type: string, enum: ["BAD_REQ"] }
        "404":
          description: missing
          content:
            application/json:
              schema:
                type: object
                required: [code, message]
                properties:
                  code: { type: string, const: "NOT_FOUND" }
                  message: { type: string }
  /query-styles:
    get:
      tags: [Search]
      operationId: queryStyles
      parameters:
        - in: query
          name: filter
          style: deepObject
          explode: true
          schema:
            type: object
            properties:
              min_amt: { type: number }
              since: { type: string, format: date-time }
        - in: query
          name: pipe
          style: pipeDelimited
          explode: false
          schema: { type: array, items: { type: string } }
        - in: query
          name: space
          style: spaceDelimited
          explode: false
          schema: { type: array, items: { type: number } }
        - in: query
          name: csv_arr
          style: form
          explode: false
          schema: { type: array, items: { type: string } }
        - in: query
          name: csv_obj
          style: form
          explode: false
          schema:
            type: object
            properties:
              a: { type: string }
        - in: query
          name: csv_scalar
          style: form
          explode: false
          schema: { type: string }
        - in: query
          name: repeated
          style: form
          explode: true
          schema: { type: array, items: { type: string } }
        - in: query
          name: term
          style: form
          explode: true
          schema: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }
  /form:
    post:
      tags: [Forms]
      operationId: submitForm
      requestBody:
        required: true
        content:
          application/x-www-form-urlencoded:
            schema:
              type: object
              required: [customer_name]
              properties:
                customer_name: { type: string }
      responses:
        "200":
          description: ok
          content:
            text/plain:
              schema: { type: string }
  /upload:
    post:
      tags: [Forms]
      operationId: uploadAsset
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [asset]
              properties:
                asset: { type: string, format: binary }
      responses:
        "200":
          description: ok
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
  /events:
    post:
      tags: [Events]
      operationId: streamEvents
      responses:
        "200":
          description: stream
          content:
            text/event-stream:
              itemSchema:
                oneOf:
                  - type: object
                    required: [event, data]
                    properties:
                      event: { type: string, const: "progress" }
                      data:
                        type: object
                        required: [pct]
                        properties:
                          pct: { type: number }
                  - type: object
                    required: [event, data]
                    properties:
                      event: { type: string, const: "done" }
                      data: { type: string }
  /tree-groups:
    get:
      tags: [Orders]
      operationId: listTreeGroups
      responses:
        "200":
          description: tree groups
          content:
            application/json:
              schema: { $ref: "#/components/schemas/TreeGroupList" }
  /pets:
    post:
      tags: [Orders]
      operationId: echoPet
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PetChoice" }
      responses:
        "200":
          description: pet
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PetChoice" }
components:
  schemas:
    OrderPayload:
      type: object
      required: [customer_name, created_at]
      properties:
        customer_name: { type: string, minLength: 1 }
        created_at: { type: string, format: date-time }
    TreeGroupList:
      type: array
      items: { $ref: "#/components/schemas/TreeGroup" }
    TreeGroup:
      type: object
      required: [name]
      properties:
        name: { type: string }
        items: { $ref: "#/components/schemas/TreeGroupList" }
    PetDog:
      type: object
      required: [kind, bark]
      properties:
        kind: { type: string, const: dog }
        bark: { type: boolean }
    PetCat:
      type: object
      required: [kind, meow]
      properties:
        kind: { type: string, const: cat }
        meow: { type: boolean }
    PetChoice:
      oneOf:
        - $ref: "#/components/schemas/PetDog"
        - $ref: "#/components/schemas/PetCat"
      discriminator:
        propertyName: kind
`;

    for (const format of ["ts", "mjs"] as const) {
      const outSub = join(tmp, `gen-${format}`);
      const res = await generateOpenApi({
        cwd: tmp,
        target: {
          input: spec,
          output: { dir: outSub, format },
          errorStrategy: "union",
        },
      });
      expect(res.diagnostics.map((d) => d.code)).toContain(
        "CLI_UNSUPPORTED_WEBHOOKS",
      );
      expect(res.diagnostics.map((d) => d.code)).toContain(
        "CLI_UNSUPPORTED_COOKIE_PARAM",
      );

      // Generated code must be stateless ESM (no classes or createClient) and have PURE annotations
      const entryExt = format === "mjs" ? ".mjs" : ".ts";
      const ordersCode = readFileSync(
        join(outSub, `request/orders${entryExt}`),
        "utf8",
      );
      expect(ordersCode).toContain("/*#__PURE__*/");
      expect(ordersCode).not.toContain("createClient");
      expect(ordersCode).not.toContain("class ");
      expect(ordersCode).toContain("body: input.body");

      const ordersSchemaCode = readFileSync(
        join(outSub, `schema/orders${entryExt}`),
        "utf8",
      );
      expect(ordersSchemaCode.indexOf("export const TreeGroup")).toBeLessThan(
        ordersSchemaCode.indexOf("export const TreeGroupList"),
      );
      expect(ordersSchemaCode.indexOf("export const PetDog")).toBeLessThan(
        ordersSchemaCode.indexOf("export const PetChoice"),
      );
      expect(ordersSchemaCode).toContain('struct.discriminatedUnion("kind"');

      const bundle = await loadGeneratedModule(outSub, `index${entryExt}`);
      const rootMod = bundle.mod;
      const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));

      // 1. JSON body passthrough preserving .alias("customer_name") and Date encoding
      const updateOrder = getOp(rootMod, "updateOrder");
      const [err1, ok1] = await updateOrder(client, {
        orderId: "ord-1",
        headers: { xRequestId: "req-99" },
        body: {
          customerName: "Alice",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      expect(err1).toBeNull();
      expect(ok1).toMatchObject({ customerName: "Alice" });
      expect(JSON.parse(observed.at(-1)?.bodyText ?? "{}")).toEqual({
        customer_name: "Alice",
        created_at: "2026-01-01T00:00:00.000Z",
      });
      expect(observed.at(-1)?.headers["x-request-id"]).toBe("req-99");

      // 2. Non-2xx errorStrategy: "union" decoding
      const [errFail] = await updateOrder(client, {
        orderId: "fail",
        body: {
          customerName: "Bob",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });
      expect(errFail).toMatchObject({
        code: "HTTP_STATUS",
        status: 404,
        data: { code: "NOT_FOUND", message: "Missing order" },
      });

      // 3. Non-default query styles
      const queryStyles = getOp(rootMod, "queryStyles");
      const [qErr, qRes] = await queryStyles(client, {
        query: {
          filter: { minAmt: 10, since: "2026-02-01T00:00:00.000Z" },
          pipe: ["a", "b"],
          space: [1, 2],
          csvArr: ["x", "y"],
          csvObj: { a: "1" },
          csvScalar: "v",
          repeated: ["r1", "r2"],
          term: "hello",
        },
      });
      expect(qErr).toBeNull();
      expect(qRes).toEqual({ ok: true });
      const rawUrl = observed.at(-1)?.url ?? "";
      expect(rawUrl).toContain("filter%5BminAmt%5D=10");
      expect(rawUrl).toContain("pipe=a%7Cb");
      expect(rawUrl).toContain("space=1+2");
      expect(rawUrl).toContain("csv_arr=x%2Cy");
      expect(rawUrl).toContain("csv_obj=a%2C1");
      expect(rawUrl).toContain("csv_scalar=v");
      expect(rawUrl).toContain("repeated=r1&repeated=r2");
      expect(rawUrl).toContain("term=hello");

      // 4. Form URL-encoded with alias + text/plain output
      const submitForm = getOp(rootMod, "submitForm");
      const [fErr, fRes] = await submitForm(client, {
        body: { customerName: "Bob Smith" },
      });
      expect(fErr).toBeNull();
      expect(fRes).toBe("form-ok");
      expect(observed.at(-1)?.bodyText).toBe("customer_name=Bob+Smith");

      // 5. Multipart formData + Blob binary response
      const uploadAsset = getOp(rootMod, "uploadAsset");
      const [uErr, uRes] = await uploadAsset(client, {
        body: { asset: new File(["abc"], "hello.txt") },
      });
      expect(uErr).toBeNull();
      expect(uRes).toBeInstanceOf(Blob);

      // 6. SSE defineEventStream E2E + recursive SCC & discriminated union $ref runtime checks
      const listTreeGroups = getOp(rootMod, "listTreeGroups");
      const [tgErr, tgRes] = await listTreeGroups(client);
      expect(tgErr).toBeNull();
      expect(tgRes).toEqual([{ name: "root", items: [{ name: "leaf" }] }]);

      const echoPet = getOp(rootMod, "echoPet");
      const [petErr, petRes] = await echoPet(client, {
        body: { kind: "dog", bark: true },
      });
      expect(petErr).toBeNull();
      expect(petRes).toEqual({ kind: "dog", bark: true });

      if (format === "ts") {
        const streamEvents = getOp(rootMod, "streamEvents");
        const [sErr, stream] = await streamEvents(client);
        expect(sErr).toBeNull();
        const items: unknown[] = [];
        if (isAsyncIterable(stream)) {
          for await (const ev of stream) {
            items.push(ev);
          }
        }
        expect(items).toEqual([
          { event: "progress", data: { pct: 50 }, id: undefined },
          { event: "done", data: "ok", id: undefined },
        ]);
      }
    }
  });

  test("emits lint and formatter ignore directives without formatting and handles negative literals and AST edge nodes", async () => {
    const tmp = createTempDir("defjs-cli-ast-headers-");
    const syncDir = join(tmp, "sync-out");
    const spec = {
      openapi: "3.1.0",
      info: { title: "AstHeaders", version: "1.0.0" },
      components: {
        schemas: {
          NegCode: { const: -1 },
          AlphaRef: { type: "object", properties: { a: { type: "string" } } },
          BetaRef: { type: "object", properties: { b: { type: "number" } } },
          CombinedRef: {
            type: "object",
            properties: {
              a: { $ref: "#/components/schemas/AlphaRef" },
              b: { $ref: "#/components/schemas/BetaRef" },
            },
          },
        },
      },
      paths: {
        "/alpha": {
          get: {
            tags: ["Alpha"],
            operationId: "getAlphaRef",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/AlphaRef" },
                  },
                },
              },
            },
          },
        },
        "/beta": {
          get: {
            tags: ["Beta"],
            operationId: "getBetaRef",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/BetaRef" },
                  },
                },
              },
            },
          },
        },
        "/neg": {
          post: {
            tags: ["Neg"],
            operationId: "postNeg",
            parameters: [
              {
                in: "query",
                name: "items",
                style: "form",
                explode: false,
                schema: { type: "array", items: { type: "string" } },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      code: { $ref: "#/components/schemas/NegCode" },
                      combined: { $ref: "#/components/schemas/CombinedRef" },
                    },
                  },
                },
              },
            },
            responses: { "204": { description: "ok" } },
          },
        },
      },
    };

    await generateOpenApi({
      cwd: tmp,
      target: {
        input: spec,
        output: { dir: syncDir, format: "js" },
        mode: "sync",
      },
    });

    const expectedToolIgnores = [
      "/* eslint-disable */",
      "/* oxlint-disable */",
      "// biome-ignore-all lint: generated file",
      "// biome-ignore-all format: generated file",
      "// biome-ignore-all assist: generated file",
      "// deno-lint-ignore-file",
      "// deno-fmt-ignore-file",
      "// dprint-ignore-file",
    ];
    for (const rel of [
      "index.js",
      "index.d.ts",
      "schema/neg.js",
      "schema/neg.d.ts",
      "request/neg.js",
      "request/neg.d.ts",
      "util.js",
      "util.d.ts",
    ]) {
      const content = readFileSync(join(syncDir, rel), "utf8");
      expect(
        content.startsWith(
          "// Generated by @defjs/cli. Do not edit directly.\n// @generated\n",
        ),
      ).toBe(true);
      for (const line of expectedToolIgnores) {
        expect(content).toContain(line);
      }
      expect(content).not.toContain("@ts-nocheck");
    }
    expect(readFileSync(join(syncDir, "schema/neg.js"), "utf8")).toContain(
      "struct.literal(-1)",
    );
    expect(readFileSync(join(syncDir, "schema/neg.d.ts"), "utf8")).toContain(
      "export type NegCode = -1;",
    );

    const scaffoldDir = join(tmp, "scaffold-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: spec,
        output: { dir: scaffoldDir, format: "ts" },
        mode: "scaffold",
      },
    });
    const scaffoldContent = readFileSync(join(scaffoldDir, "index.ts"), "utf8");
    expect(scaffoldContent.startsWith("// Scaffolded by @defjs/cli.\n")).toBe(
      true,
    );
    expect(scaffoldContent).not.toContain("// @generated");
    for (const line of expectedToolIgnores) {
      expect(scaffoldContent).toContain(line);
    }

    // Exercise util function closure resolution, duplicate dependency skipping, and tsx format rendering
    const closure = resolveUtilFunctionClosure(
      new Set(["appendFormQuery", "appendPipeDelimitedQuery", "missingHelper"]),
      OPENAPI_UTIL_CATALOG,
    );
    expect(closure.map((fn) => fn.name)).toEqual([
      "isParamRecord",
      "stringifyParam",
      "appendDelimited",
      "appendFormQuery",
      "appendPipeDelimitedQuery",
    ]);
    const tsxUtil = renderOpenApiUtilCode(new Set(["appendFormQuery"]), {
      header: "// @generated",
      format: "tsx",
    });
    expect(tsxUtil).toContain("export function appendFormQuery(");
  });

  test("hoists all operation schemas, deduplicates reusable parameter schemas, and avoids diverging Input collisions", async () => {
    const tmp = createTempDir("defjs-cli-hoisted-schemas-");

    // 1. Multi-file external parameter $ref + Swagger 2.0 top-level parameters
    const extParamDir = join(tmp, "ext-param");
    mkdirSync(join(extParamDir, "params"), { recursive: true });
    writeFileSync(
      join(extParamDir, "params/page.yaml"),
      `name: page
in: query
required: false
schema:
  type: integer
`,
    );
    writeFileSync(
      join(extParamDir, "openapi.yaml"),
      `openapi: 3.1.0
info: { title: ExtParam, version: "1.0.0" }
paths:
  /ext-a:
    get:
      tags: [GroupA]
      operationId: getExtA
      parameters:
        - $ref: "./params/page.yaml"
      responses:
        "204": { description: ok }
  /ext-b:
    get:
      tags: [GroupB]
      operationId: getExtB
      parameters:
        - $ref: "./params/page.yaml"
      responses:
        "204": { description: ok }
`,
    );
    const extOutDir = join(tmp, "ext-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: join(extParamDir, "openapi.yaml"),
        output: { dir: extOutDir, format: "ts" },
      },
    });
    const extShared = readFileSync(join(extOutDir, "schema/shared.ts"), "utf8");
    expect(extShared).toContain("export const Page =");

    // 2. OpenAPI 3.2: reusable parameters, content-only params, nullable header param ref,
    // diverging schema collision (`Item` + `item` -> `ItemInput2`), diverging SSE error in JS mode,
    // optional input, and mixed2xx omit vs split.
    const spec = {
      openapi: "3.2.0",
      info: { title: "Hoisted", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            tags: ["Catalog"],
            operationId: "item",
            parameters: [
              { $ref: "#/components/parameters/SharedFields" },
              { $ref: "#/components/parameters/ExistingIdParam" },
              { $ref: "#/components/parameters/ContentFilter" },
              { $ref: "#/components/parameters/NullableTagHeader" },
              {
                in: "query",
                name: "since",
                required: false,
                schema: { type: "string", format: "date-time" },
              },
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Item" },
                  },
                },
              },
              "204": { description: "empty" },
            },
          },
        },
        "/orders": {
          get: {
            tags: ["Orders"],
            operationId: "listOrders",
            parameters: [{ $ref: "#/components/parameters/SharedFields" }],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["total"],
                      properties: { total: { type: "number" } },
                    },
                  },
                },
              },
              "400": {
                description: "bad",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["reason"],
                      properties: { reason: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
        "/events": {
          get: {
            tags: ["Stream"],
            operationId: "streamItems",
            responses: {
              "200": {
                description: "stream",
                content: {
                  "text/event-stream": {
                    itemSchema: {
                      oneOf: [
                        {
                          type: "object",
                          required: ["event", "data"],
                          properties: {
                            event: { type: "string", const: "item" },
                            data: { $ref: "#/components/schemas/Item" },
                          },
                        },
                        {
                          type: "object",
                          required: ["event", "data"],
                          properties: {
                            event: { type: "string", const: "heartbeat" },
                            data: { type: "number" },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              "500": {
                description: "stream err",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["at"],
                      properties: {
                        at: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ExistingId: { type: "string" },
          Item: {
            type: "object",
            required: ["id", "createdAt"],
            properties: {
              id: { $ref: "#/components/schemas/ExistingId" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
        },
        parameters: {
          SharedFields: {
            in: "query",
            name: "fields",
            required: false,
            style: "form",
            explode: false,
            schema: {
              type: "array",
              items: { type: "string" },
            },
          },
          ExistingIdParam: {
            in: "query",
            name: "existing_id",
            required: false,
            schema: { $ref: "#/components/schemas/ExistingId" },
          },
          ContentFilter: {
            in: "query",
            name: "filter",
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { active: { type: "boolean" } },
                },
              },
            },
          },
          NullableTagHeader: {
            in: "header",
            name: "X-Tag-List",
            required: false,
            schema: {
              type: ["array", "null"],
              items: { type: "string" },
            },
          },
        },
      },
    };

    const tsDir = join(tmp, "hoisted-ts");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: spec,
        output: { dir: tsDir, format: "ts" },
        errorStrategy: "union",
        mixed2xxStrategy: "omit",
      },
    });
    const tsReqCatalog = readFileSync(
      join(tsDir, "request/catalog.ts"),
      "utf8",
    );
    expect(tsReqCatalog).not.toContain("struct.");
    expect(tsReqCatalog).toContain("input: /*#__PURE__*/ ItemInput.optional()");
    expect(tsReqCatalog).toContain("!== undefined && h.xTagList !== null");
    const tsSchemaCatalog = readFileSync(
      join(tsDir, "schema/catalog.ts"),
      "utf8",
    );
    expect(tsSchemaCatalog).toContain("export const ItemInput =");
    expect(tsSchemaCatalog).toContain(
      "export type ItemInput = StructInput<typeof ItemInput>;",
    );
    expect(tsSchemaCatalog).not.toContain("ItemOutput");
    const tsSchemaShared = readFileSync(
      join(tsDir, "schema/shared.ts"),
      "utf8",
    );
    expect(tsSchemaShared).toContain("export const SharedFields =");
    expect(tsSchemaShared).toContain("export const ExistingId =");
    expect(tsSchemaShared).not.toContain("ExistingIdParam");

    const jsDir = join(tmp, "hoisted-js");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: spec,
        output: { dir: jsDir, format: "js" },
        errorStrategy: "union",
        mixed2xxStrategy: "split",
      },
    });
    const jsSchemaCatalogDts = readFileSync(
      join(jsDir, "schema/catalog.d.ts"),
      "utf8",
    );
    expect(jsSchemaCatalogDts).toContain(
      "export declare const ItemInput: Struct<ItemInput, {",
    );
    expect(jsSchemaCatalogDts).toContain("since?: Date | number | string;");
    expect(jsSchemaCatalogDts).toContain("since?: Date;");
    expect(jsSchemaCatalogDts).not.toContain("ItemInputInput");
    expect(jsSchemaCatalogDts).toContain("export type ItemInput = {");
    const jsSchemaSharedDts = readFileSync(
      join(jsDir, "schema/shared.d.ts"),
      "utf8",
    );
    expect(jsSchemaSharedDts).toContain("export type ItemInput2 = {");
    expect(jsSchemaSharedDts).toContain(
      "export declare const Item: Struct<ItemInput2, Item>;",
    );
    const jsReqCatalogDts = readFileSync(
      join(jsDir, "request/catalog.d.ts"),
      "utf8",
    );
    expect(jsReqCatalogDts).toContain(
      "export declare const item: RequestEndpoint<[input?: ItemInput], Item, undefined, DecodedResponse<Item>>;",
    );
    expect(jsReqCatalogDts).toContain(
      "export declare const itemNoContent: RequestEndpoint<[input?: ItemInput], undefined, undefined, HttpMeta>;",
    );
    const jsReqCatalog = readFileSync(
      join(jsDir, "request/catalog.js"),
      "utf8",
    );
    expect(jsReqCatalog).not.toContain("ItemNoContentInput");
    const jsReqStreamDts = readFileSync(
      join(jsDir, "request/stream.d.ts"),
      "utf8",
    );
    expect(jsReqStreamDts).toContain(
      'import type { Item } from "../schema/shared.js";',
    );
    expect(jsReqStreamDts).toContain(
      'import type { StreamItemsError, StreamItemsErrorInput, StreamItemsHeartbeatEvent } from "../schema/stream.js";',
    );
    expect(jsReqStreamDts).toContain(
      "Struct<StreamItemsErrorInput, StreamItemsError>",
    );

    // 3. Swagger 2.0 top-level `parameters` deduplication
    const sw2ParamsSpec = `swagger: "2.0"
info: { title: Sw2Params, version: "1.0" }
parameters:
  SharedTag:
    name: tag
    in: query
    type: string
paths:
  /sw-a:
    get:
      tags: [SwA]
      parameters:
        - $ref: "#/parameters/SharedTag"
      responses:
        "200":
          description: ok
          schema: { type: string }
  /sw-b:
    get:
      tags: [SwB]
      parameters:
        - $ref: "#/parameters/SharedTag"
      responses:
        "204":
          description: empty
`;
    const sw2ParamsDir = join(tmp, "sw2-params");
    await generateOpenApi({
      cwd: tmp,
      target: { input: sw2ParamsSpec, output: { dir: sw2ParamsDir } },
    });
    expect(
      readFileSync(join(sw2ParamsDir, "schema/shared.ts"), "utf8"),
    ).toContain("export const SharedTag =");
    expect(
      readFileSync(join(sw2ParamsDir, "request/sw-a.ts"), "utf8"),
    ).not.toContain("struct.");
  });
});
