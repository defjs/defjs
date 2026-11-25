import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { globSync } from "tinyglobby";
import { describe, expect, onTestFinished, test } from "vitest";
import { generateOpenApi } from "./index.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");

const COMPREHENSIVE_OPENAPI = `openapi: 3.2.0
info:
  title: Comprehensive Verification API
  version: 1.0.0
paths:
  /categories:
    post:
      tags: [Catalog]
      operationId: createCategory
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Category"
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Category"
        "400":
          description: validation
          content:
            application/json:
              schema:
                type: object
                required: [code, message]
                properties:
                  code: { type: string, const: "BAD_INPUT" }
                  message: { type: string }
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
  /categories/{id}:
    patch:
      tags: [Catalog]
      operationId: patchCategory
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PatchCategoryRequest"
      responses:
        "204":
          description: updated
  /search:
    get:
      tags: [Catalog]
      operationId: searchCatalog
      parameters:
        - in: query
          name: filter
          style: deepObject
          explode: true
          schema:
            type: object
            properties:
              min_price: { type: number }
              since: { type: string, format: date-time }
        - in: query
          name: tags
          style: pipeDelimited
          explode: false
          schema:
            type: array
            items: { type: string }
        - in: query
          name: space_tags
          style: spaceDelimited
          explode: false
          schema:
            type: array
            items: { type: string }
        - in: query
          name: form_csv
          style: form
          explode: false
          schema:
            type: array
            items: { type: string }
        - in: query
          name: json_filter
          content:
            application/json:
              schema:
                type: object
                properties:
                  exact: { type: boolean }
        - in: header
          name: X-Trace-Id
          required: false
          schema:
            type: string
            nullable: true
        - in: header
          name: X-Header-Tags
          required: false
          schema:
            type: array
            items: { type: string }
      responses:
        "200":
          description: results
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Category"
        "204":
          description: empty
  /styled/{simple_arr}/{label_val}/{matrix_val}/{json_path}:
    get:
      tags: [Catalog]
      operationId: getStyledItem
      parameters:
        - in: path
          name: simple_arr
          required: true
          style: simple
          schema:
            type: array
            items: { type: number }
        - in: path
          name: label_val
          required: true
          style: label
          explode: true
          schema:
            type: array
            items: { type: string }
        - in: path
          name: matrix_val
          required: true
          style: matrix
          explode: false
          schema:
            type: string
        - in: path
          name: json_path
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
      responses:
        "204":
          description: ok
  /uploads:
    post:
      tags: [Files]
      operationId: uploadFile
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file_data]
              properties:
                file_data: { type: string, format: binary }
                display_name: { type: string }
      responses:
        "201":
          description: uploaded
          content:
            text/plain:
              schema: { type: string }
  /events:
    get:
      tags: [Events]
      operationId: watchEvents
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
                      event: { type: string, const: "updated" }
                      data:
                        $ref: "#/components/schemas/Category"
                  - type: object
                    required: [event, data]
                    properties:
                      event: { type: string, const: "done" }
                      data: { type: string }
        "500":
          description: error
          content:
            application/json:
              schema:
                type: object
                required: [reason]
                properties:
                  reason: { type: string }
components:
  schemas:
    PatchCategoryRequest:
      type: object
      anyOf:
        - required: [name]
        - required: [note]
      properties:
        name: { type: string }
        note: { type: string }
    Category:
      type: object
      required: [id, created_at]
      properties:
        id: { type: string }
        created_at: { type: string, format: date-time }
        children:
          type: array
          items:
            $ref: "#/components/schemas/Category"
`;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

describe("@defjs/cli (Bun verification)", () => {
  test.each(["ts", "tsx", "js", "mjs"] as const)(
    "emitted %s output passes bun check and TS/TSX passes repo oxlint",
    async (format) => {
      const workDir = createTempDir(`defjs-cli-check-${format}-`);
      const outDir = join(workDir, "generated");

      await generateOpenApi({
        cwd: workDir,
        target: {
          input: COMPREHENSIVE_OPENAPI,
          output: { dir: outDir, format },
          errorStrategy: "union",
          mixed2xxStrategy: "split",
        },
      });

      const consumerFile = join(
        workDir,
        format === "mjs" ? "verify.mts" : "verify.ts",
      );
      const importTarget =
        format === "mjs"
          ? "./generated/index.mjs"
          : format === "js"
            ? "./generated/index.js"
            : "./generated/index";
      writeFileSync(
        consumerFile,
        `import { createClient, withEndpoint } from "@defjs/core";
import {
  createCategory,
  getStyledItem,
  patchCategory,
  searchCatalog,
  searchCatalogNoContent,
  uploadFile,
  watchEvents,
  type CreateCategoryError,
  type CreateCategoryInput,
  type SearchCatalogInput,
  type SearchCatalogOutput,
  type UploadFileInput,
  type UploadFileOutput,
  type WatchEventsDoneEvent,
  type WatchEventsError,
} from ${JSON.stringify(importTarget)};

export type VerifyTypeRefs = [
  UploadFileInput,
  UploadFileOutput,
  WatchEventsDoneEvent,
  WatchEventsError,
];

export async function verify(): Promise<void> {
  const client = createClient(withEndpoint("https://api.example.com"));
  const createInput: CreateCategoryInput = {
    body: { id: "1", createdAt: new Date(), children: [] },
  };
  const [catErr, cat] = await createCategory(client, createInput);
  if (catErr) {
    const _typedErr: CreateCategoryError | undefined =
      catErr.code === "HTTP_STATUS" ? catErr.data : undefined;
    void _typedErr;
    return;
  }
  void cat.id;
  await patchCategory(client, { id: "1", body: { name: "Updated" } });
  const searchInput: SearchCatalogInput = {
    query: {
      filter: { minPrice: 5, since: "2026-01-01T00:00:00Z" },
      tags: ["a"],
      spaceTags: ["s"],
      formCsv: ["f"],
      jsonFilter: { exact: true },
    },
    headers: { xTraceId: "t", xHeaderTags: ["h"] },
  };
  const [searchErr, searchOut] = await searchCatalog(client, searchInput);
  if (searchErr) {
    return;
  }
  const _typedOut: SearchCatalogOutput = searchOut;
  void _typedOut;
  await getStyledItem(client, {
    simpleArr: [1, 2],
    labelVal: ["x"],
    matrixVal: "m",
    jsonPath: { id: "p" },
  });
  await searchCatalogNoContent(client);
  void uploadFile;
  await watchEvents(client);
}
`,
      );

      writeFileSync(
        join(workDir, "tsconfig.json"),
        JSON.stringify({
          extends: join(repoRoot, "tsconfig.base.json"),
          compilerOptions: {
            types: [],
            ...(format === "tsx" ? { jsx: "react-jsx" } : {}),
            paths: {
              "@defjs/core": [join(repoRoot, "packages/core/src")],
            },
          },
          include: [
            "*.ts",
            "*.mts",
            "generated/**/*.ts",
            "generated/**/*.tsx",
            "generated/**/*.mts",
          ],
        }),
      );

      const checkProc = Bun.spawnSync(
        ["bun", "check", "--project", join(workDir, "tsconfig.json")],
        { cwd: workDir, stdout: "pipe", stderr: "pipe" },
      );
      expect(
        checkProc.exitCode,
        `${checkProc.stdout.toString()}\n${checkProc.stderr.toString()}`,
      ).toBe(0);

      for (const reqRel of globSync(["request/*.{ts,tsx,js,mjs}"], {
        cwd: outDir,
      })) {
        const reqContent = readFileSync(join(outDir, reqRel), "utf8");
        expect(reqContent).not.toContain("struct.");
        expect(reqContent).not.toMatch(
          /import\s*\{[^}]*\bstruct\b[^}]*\}\s*from\s*["']@defjs\/core["']/,
        );
      }

      if (format === "ts" || format === "tsx") {
        const entryFile = join(outDir, `index.${format}`);
        const entryContent = readFileSync(entryFile, "utf8");
        expect(entryContent).toContain("/* eslint-disable */");
        expect(entryContent).toContain("/* oxlint-disable */");
        expect(entryContent).toContain(
          "// biome-ignore-all format: generated file",
        );
        expect(entryContent).toContain("// dprint-ignore-file");

        // 1. Out of the box, oxlint cleanly accepts generated files with disable directives.
        const lintWithHeader = Bun.spawnSync(
          [
            join(repoRoot, "node_modules/.bin/oxlint"),
            "--config",
            join(repoRoot, "oxlint.config.ts"),
            "--report-unused-disable-directives-severity",
            "off",
            outDir,
          ],
          { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
        );
        expect(
          lintWithHeader.exitCode,
          `${lintWithHeader.stdout.toString()}\n${lintWithHeader.stderr.toString()}`,
        ).toBe(0);

        // 2. With disable lines stripped, generated code itself must also pass strict repo oxlint.
        const strippedDir = join(workDir, "generated-stripped");
        cpSync(outDir, strippedDir, { recursive: true });
        writeFileSync(
          join(strippedDir, "tsconfig.json"),
          JSON.stringify({
            extends: "../tsconfig.json",
            include: ["**/*.ts", "**/*.tsx"],
          }),
        );
        for (const rel of globSync(["**/*.{ts,tsx}"], { cwd: strippedDir })) {
          const filePath = join(strippedDir, rel);
          const stripped = readFileSync(filePath, "utf8")
            .replace(/^\/\* eslint-disable \*\/\n/m, "")
            .replace(/^\/\* oxlint-disable \*\/\n/m, "");
          writeFileSync(filePath, stripped, "utf8");
        }
        const lintStripped = Bun.spawnSync(
          [
            join(repoRoot, "node_modules/.bin/oxlint"),
            "--config",
            join(repoRoot, "oxlint.config.ts"),
            strippedDir,
          ],
          { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
        );
        expect(
          lintStripped.exitCode,
          `${lintStripped.stdout.toString()}\n${lintStripped.stderr.toString()}`,
        ).toBe(0);
      }
    },
    30_000,
  );

  test.each(["2.0", "3.0.4", "3.1.2", "3.2.0"] as const)(
    "emitted ts and js outputs for protocol %s pass bun check and repo oxlint",
    async (protoVersion) => {
      const workDir = createTempDir(`defjs-cli-proto-${protoVersion}-`);
      const spec =
        protoVersion === "2.0"
          ? {
              swagger: "2.0",
              info: { title: "Sw2Check", version: "1.0.0" },
              consumes: ["application/json"],
              produces: ["application/json"],
              paths: {
                "/items/{item_id}": {
                  get: {
                    tags: ["Items"],
                    operationId: "getItem",
                    parameters: [
                      {
                        in: "path",
                        name: "item_id",
                        required: true,
                        type: "string",
                      },
                      {
                        in: "query",
                        name: "tags",
                        type: "array",
                        items: { type: "string" },
                        collectionFormat: "pipes",
                      },
                    ],
                    responses: {
                      "200": {
                        description: "ok",
                        schema: { $ref: "#/definitions/ItemModel" },
                      },
                    },
                  },
                },
                "/upload": {
                  post: {
                    tags: ["Items"],
                    operationId: "uploadDoc",
                    consumes: ["multipart/form-data"],
                    parameters: [
                      {
                        in: "formData",
                        name: "file",
                        type: "file",
                        required: true,
                      },
                    ],
                    responses: { "204": { description: "ok" } },
                  },
                },
              },
              definitions: {
                ItemModel: {
                  type: "object",
                  required: ["id"],
                  properties: {
                    id: { type: "string" },
                    note: { type: "string", "x-nullable": true },
                  },
                },
              },
            }
          : protoVersion === "3.0.4"
            ? {
                openapi: "3.0.4",
                info: { title: "Oa304Check", version: "1.0.0" },
                paths: {
                  "/items/{item_id}": {
                    get: {
                      tags: ["Items"],
                      operationId: "getItem",
                      parameters: [
                        {
                          in: "path",
                          name: "item_id",
                          required: true,
                          schema: { type: "string" },
                        },
                      ],
                      responses: {
                        "200": {
                          description: "ok",
                          content: {
                            "application/json": {
                              schema: {
                                $ref: "#/components/schemas/ItemModel",
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  "/upload": {
                    post: {
                      tags: ["Items"],
                      operationId: "uploadDoc",
                      requestBody: {
                        required: true,
                        content: {
                          "multipart/form-data": {
                            schema: {
                              type: "object",
                              required: ["file"],
                              properties: {
                                file: { type: "string", format: "binary" },
                              },
                            },
                          },
                        },
                      },
                      responses: { "204": { description: "ok" } },
                    },
                  },
                },
                components: {
                  schemas: {
                    ItemModel: {
                      type: "object",
                      required: ["id"],
                      properties: {
                        id: { type: "string" },
                        note: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              }
            : protoVersion === "3.1.2"
              ? {
                  openapi: "3.1.2",
                  info: { title: "Oa312Check", version: "1.0.0" },
                  paths: {
                    "/items/{item_id}": {
                      get: {
                        tags: ["Items"],
                        operationId: "getItem",
                        parameters: [
                          {
                            in: "path",
                            name: "item_id",
                            required: true,
                            schema: { type: "string" },
                          },
                        ],
                        responses: {
                          "200": {
                            description: "ok",
                            content: {
                              "application/json": {
                                schema: {
                                  $ref: "#/components/schemas/ItemModel",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    "/upload": {
                      post: {
                        tags: ["Items"],
                        operationId: "uploadDoc",
                        requestBody: {
                          required: true,
                          content: {
                            "multipart/form-data": {
                              schema: {
                                type: "object",
                                required: ["file"],
                                properties: {
                                  file: {
                                    contentMediaType:
                                      "application/octet-stream",
                                  },
                                },
                              },
                            },
                          },
                        },
                        responses: { "204": { description: "ok" } },
                      },
                    },
                  },
                  components: {
                    schemas: {
                      ItemModel: {
                        type: "object",
                        required: ["id"],
                        properties: {
                          id: { type: "string" },
                          pair: {
                            type: "array",
                            prefixItems: [
                              { type: "string" },
                              { type: "integer" },
                            ],
                            items: false,
                          },
                        },
                      },
                    },
                  },
                }
              : {
                  openapi: "3.2.0",
                  info: { title: "Oa320Check", version: "1.0.0" },
                  paths: {
                    "/search": {
                      query: {
                        tags: ["Items"],
                        operationId: "getItem",
                        requestBody: {
                          required: true,
                          content: {
                            "application/json": {
                              schema: {
                                type: "object",
                                required: ["item_id"],
                                properties: { item_id: { type: "string" } },
                              },
                            },
                          },
                        },
                        responses: {
                          "200": {
                            description: "ok",
                            content: {
                              "application/json": {
                                schema: {
                                  $ref: "#/components/schemas/ItemModel",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    "/purge": {
                      additionalOperations: {
                        PURGE: {
                          tags: ["Items"],
                          operationId: "purgeItems",
                          parameters: [
                            {
                              in: "querystring",
                              name: "qs",
                              required: false,
                              content: {
                                "application/x-www-form-urlencoded": {
                                  schema: {
                                    type: "object",
                                    properties: { scope: { type: "string" } },
                                  },
                                },
                              },
                            },
                          ],
                          responses: { "204": { description: "ok" } },
                        },
                      },
                    },
                    "/upload": {
                      post: {
                        tags: ["Items"],
                        operationId: "uploadDoc",
                        requestBody: {
                          required: true,
                          content: {
                            "multipart/form-data": {
                              schema: {
                                type: "object",
                                required: ["file"],
                                properties: {
                                  file: {
                                    contentMediaType:
                                      "application/octet-stream",
                                  },
                                },
                              },
                            },
                          },
                        },
                        responses: { "204": { description: "ok" } },
                      },
                    },
                    "/events": {
                      get: {
                        tags: ["Items"],
                        operationId: "watchItems",
                        responses: {
                          "200": {
                            description: "ok",
                            content: {
                              "text/event-stream": {
                                itemSchema: {
                                  type: "object",
                                  required: ["event", "data"],
                                  properties: {
                                    event: { type: "string", const: "tick" },
                                    data: { type: "string" },
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
                      ItemModel: {
                        type: "object",
                        required: ["id"],
                        properties: { id: { type: "string" } },
                      },
                    },
                  },
                };

      for (const fmt of ["ts", "js"] as const) {
        const subDir = join(workDir, fmt);
        const outDir = join(subDir, "generated");
        await generateOpenApi({
          cwd: subDir,
          target: { input: spec, output: { dir: outDir, format: fmt } },
        });
        for (const reqRel of globSync(["request/*.{ts,js}"], { cwd: outDir })) {
          expect(readFileSync(join(outDir, reqRel), "utf8")).not.toContain(
            "struct.",
          );
        }
        const entryImport =
          fmt === "js" ? "./generated/index.js" : "./generated/index";
        const callGetItem =
          protoVersion === "3.2.0"
            ? `await getItem(client, { body: { itemId: "1" } });\n  await purgeItems(client, { query: { scope: "all" } });\n  await watchItems(client);`
            : `await getItem(client, { itemId: "1" });`;
        const extraImport =
          protoVersion === "3.2.0" ? ", purgeItems, watchItems" : "";
        writeFileSync(
          join(subDir, "verify.ts"),
          `import { createClient, withEndpoint } from "@defjs/core";
import { getItem, uploadDoc${extraImport} } from ${JSON.stringify(entryImport)};

export async function runVerify(): Promise<void> {
  const client = createClient(withEndpoint("https://api.example.com"));
  ${callGetItem}
  await uploadDoc(client, { body: { file: new File(["a"], "a.txt") } });
}
`,
        );
        writeFileSync(
          join(subDir, "tsconfig.json"),
          JSON.stringify({
            extends: join(repoRoot, "tsconfig.base.json"),
            compilerOptions: {
              types: [],
              paths: {
                "@defjs/core": [join(repoRoot, "packages/core/src")],
              },
            },
            include: ["verify.ts", "generated/**/*.ts"],
          }),
        );
        const checkProc = Bun.spawnSync(
          ["bun", "check", "--project", join(subDir, "tsconfig.json")],
          { cwd: subDir, stdout: "pipe", stderr: "pipe" },
        );
        expect(
          checkProc.exitCode,
          `${checkProc.stdout.toString()}\n${checkProc.stderr.toString()}`,
        ).toBe(0);

        if (fmt === "ts") {
          const strippedDir = join(subDir, "generated-stripped");
          cpSync(outDir, strippedDir, { recursive: true });
          writeFileSync(
            join(strippedDir, "tsconfig.json"),
            JSON.stringify({
              extends: "../tsconfig.json",
              include: ["**/*.ts"],
            }),
          );
          for (const rel of globSync(["**/*.ts"], { cwd: strippedDir })) {
            const fp = join(strippedDir, rel);
            writeFileSync(
              fp,
              readFileSync(fp, "utf8")
                .replace(/^\/\* eslint-disable \*\/\n/m, "")
                .replace(/^\/\* oxlint-disable \*\/\n/m, ""),
              "utf8",
            );
          }
          const lintProc = Bun.spawnSync(
            [
              join(repoRoot, "node_modules/.bin/oxlint"),
              "--config",
              join(repoRoot, "oxlint.config.ts"),
              strippedDir,
            ],
            { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
          );
          expect(
            lintProc.exitCode,
            `${lintProc.stdout.toString()}\n${lintProc.stderr.toString()}`,
          ).toBe(0);
        }
      }
    },
    30_000,
  );

  test("executes src/cli.ts directly under Bun", () => {
    const cliEntry = join(repoRoot, "packages/cli/src/cli.ts");
    const helpProc = Bun.spawnSync([process.execPath, cliEntry, "--help"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(helpProc.exitCode).toBe(0);
    expect(helpProc.stdout.toString()).toContain("USAGE");
    expect(helpProc.stdout.toString()).toContain("defjs openapi");

    const verProc = Bun.spawnSync([process.execPath, cliEntry, "--version"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(verProc.exitCode).toBe(0);
    expect(verProc.stdout.toString().trim()).toBe("0.1.0");
  });

  test("tree-shakes defineConfig from src and emits a single-file zero-dependency dist/index.js bundle", async () => {
    const workDir = createTempDir("defjs-cli-bundle-");
    const entryFile = join(workDir, "entry.ts");
    writeFileSync(
      entryFile,
      `export { defineConfig } from ${JSON.stringify(join(repoRoot, "packages/cli/src/index.ts"))};\n`,
    );

    const buildResult = await Bun.build({
      entrypoints: [entryFile],
      target: "node",
      format: "esm",
      minify: false,
    });
    expect(buildResult.success).toBe(true);
    const output = buildResult.outputs[0];
    expect(output).toBeDefined();
    const bundledText = output ? await output.text() : "";
    expect(bundledText).toContain("defineConfig");
    const forbidden = [
      "@scalar/openapi-parser",
      "@stricli/core",
      "ajv",
      "valibot",
      "tinyglobby",
      "es-toolkit",
      "pathe",
    ];
    for (const marker of forbidden) {
      expect(bundledText).not.toContain(marker);
    }

    const builtDir = join(workDir, "dist");
    const cliRoot = join(repoRoot, "packages/cli");
    writeFileSync(
      join(workDir, "package.json"),
      JSON.stringify({
        name: "single-file-tmp",
        private: true,
        type: "module",
      }),
    );
    const tsdownCfg = join(workDir, "tsdown.config.ts");
    writeFileSync(
      tsdownCfg,
      `import { resolve } from "node:path";
import cfg from ${JSON.stringify(join(cliRoot, "tsdown.config.ts"))};
export default {
  ...cfg,
  copy: [],
  tsconfig: ${JSON.stringify(join(cliRoot, "tsconfig.build.json"))},
  outDir: ${JSON.stringify(builtDir)},
  dts: false,
  entry:
    typeof cfg.entry === "object" && cfg.entry !== null && !Array.isArray(cfg.entry)
      ? Object.fromEntries(
          Object.entries(cfg.entry).map(([k, v]) => [k, resolve(${JSON.stringify(cliRoot)}, v)]),
        )
      : cfg.entry,
};
`,
    );
    const tsdownProc = Bun.spawnSync(
      [
        process.execPath,
        "--bun",
        "tsdown",
        "--config-loader",
        "native",
        "--config",
        tsdownCfg,
      ],
      { cwd: cliRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(
      tsdownProc.exitCode,
      `${tsdownProc.stdout.toString()}\n${tsdownProc.stderr.toString()}`,
    ).toBe(0);

    const builtManifest: unknown = JSON.parse(
      readFileSync(join(builtDir, "package.json"), "utf8"),
    );
    expect(
      typeof builtManifest === "object" &&
        builtManifest !== null &&
        "bin" in builtManifest
        ? builtManifest.bin
        : undefined,
    ).toEqual({ defjs: "index.js" });

    expect(
      readdirSync(builtDir).filter((file) => file.endsWith(".js")),
    ).toEqual(["index.js"]);
    const builtBundlePath = join(builtDir, "index.js");
    const builtBundleCode = readFileSync(builtBundlePath, "utf8");
    expect(builtBundleCode.startsWith("#!/usr/bin/env node\n")).toBe(true);
    const importMatches = [
      ...builtBundleCode.matchAll(/from\s*["']([^"']+)["']/g),
    ];
    expect(
      importMatches
        .map((match) => match[1] ?? "")
        .every((spec) => isBuiltin(spec)),
    ).toBe(true);

    const binProc = Bun.spawnSync(
      [process.execPath, builtBundlePath, "--version"],
      { cwd: workDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(binProc.exitCode).toBe(0);
    expect(binProc.stdout.toString().trim()).toBe("0.1.0");

    const importProc = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `import * as cli from ${JSON.stringify(builtBundlePath)}; console.log(Object.keys(cli).sort().join(","));`,
      ],
      { cwd: workDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(importProc.exitCode).toBe(0);
    expect(importProc.stdout.toString().trim()).toBe(
      "defineConfig,generateOpenApi,runCli",
    );
  });

  test("tree-shakes unused generated schemas and optional-input operations in consumer bundles", async () => {
    const workDir = createTempDir("defjs-cli-gen-treeshake-");
    const genDir = join(workDir, "generated");
    await generateOpenApi({
      cwd: workDir,
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "TreeShake", version: "1.0.0" },
          components: {
            schemas: {
              UsedModel: {
                type: "object",
                properties: { id: { type: "string" } },
              },
              UnusedModel: {
                type: "object",
                properties: {
                  unusedField: { type: "string" },
                  snake_field: { type: "number" },
                },
              },
            },
          },
          paths: {
            "/used": {
              get: {
                tags: ["Used"],
                operationId: "getUsedOp",
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/UsedModel" },
                      },
                    },
                  },
                },
              },
            },
            "/unused": {
              get: {
                tags: ["Unused"],
                operationId: "getUnusedOp",
                parameters: [
                  {
                    in: "query",
                    name: "opt_q",
                    required: false,
                    schema: { type: "string" },
                  },
                ],
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/UnusedModel" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        output: { dir: genDir, format: "ts" },
      },
    });

    const consumer = join(workDir, "consumer.ts");
    writeFileSync(
      consumer,
      `export { getUsedOp } from ${JSON.stringify(join(genDir, "index.ts"))};\n`,
    );
    const bundled = await Bun.build({
      entrypoints: [consumer],
      external: ["@defjs/core"],
      format: "esm",
      minify: false,
    });
    expect(bundled.success).toBe(true);
    const text = bundled.outputs[0] ? await bundled.outputs[0].text() : "";
    expect(text).toContain("getUsedOp");
    expect(text).toContain("UsedModel");
    expect(text).not.toContain("getUnusedOp");
    expect(text).not.toContain("UnusedModel");
    expect(text).not.toContain("unusedField");
    expect(text).not.toContain("snake_field");
    expect(text).not.toContain("opt_q");
  });

  test("emitted ts passes bun check and stripped repo oxlint for NaN/Infinity, duplicate enums, unknown nullable, and tag index", async () => {
    const workDir = createTempDir("defjs-cli-lint-edge-");
    const outDir = join(workDir, "generated");

    await generateOpenApi({
      cwd: workDir,
      target: {
        input: {
          openapi: "3.0.4",
          info: { title: "LintEdgeCases", version: "1.0.0" },
          components: {
            schemas: {
              NaN: { type: "string" },
              Infinity: { type: "number" },
              DupSingleEnum: { type: "string", enum: ["only", "only"] },
              DupMultiEnum: { type: "string", enum: ["a", "a", "b"] },
              NullableUnknown: { nullable: true },
              NullableIndexNode: {
                type: "object",
                properties: {
                  self: { $ref: "#/components/schemas/NullableIndexNode" },
                },
              },
            },
          },
          paths: {
            "/edge": {
              get: {
                tags: ["Index"],
                operationId: "getEdge",
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            nanVal: { $ref: "#/components/schemas/NaN" },
                            infVal: { $ref: "#/components/schemas/Infinity" },
                            single: {
                              $ref: "#/components/schemas/DupSingleEnum",
                            },
                            multi: {
                              $ref: "#/components/schemas/DupMultiEnum",
                            },
                            unk: {
                              $ref: "#/components/schemas/NullableUnknown",
                            },
                            node: {
                              $ref: "#/components/schemas/NullableIndexNode",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        output: { dir: outDir, format: "ts" },
      },
    });

    const schemaFiles = globSync(["schema/*.ts"], { cwd: outDir });
    const schemaCombined = schemaFiles
      .map((f) => readFileSync(join(outDir, f), "utf8"))
      .join("\n");
    expect(schemaCombined).not.toContain("unknown | null");
    expect(schemaCombined).toContain('"only"');
    expect(schemaCombined).not.toContain(
      'struct.literal("only"), struct.literal("only")',
    );
    expect(schemaCombined).not.toMatch(/\bexport const NaN\b/);
    expect(schemaCombined).not.toMatch(/\bexport const Infinity\b/);

    writeFileSync(
      join(workDir, "tsconfig.json"),
      JSON.stringify({
        extends: join(repoRoot, "tsconfig.base.json"),
        compilerOptions: {
          types: [],
          paths: {
            "@defjs/core": [join(repoRoot, "packages/core/src")],
          },
        },
        include: ["generated/**/*.ts"],
      }),
    );

    const checkProc = Bun.spawnSync(
      ["bun", "check", "--project", join(workDir, "tsconfig.json")],
      { cwd: workDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(
      checkProc.exitCode,
      `${checkProc.stdout.toString()}\n${checkProc.stderr.toString()}`,
    ).toBe(0);

    const strippedDir = join(workDir, "generated-stripped");
    cpSync(outDir, strippedDir, { recursive: true });
    writeFileSync(
      join(strippedDir, "tsconfig.json"),
      JSON.stringify({
        extends: "../tsconfig.json",
        include: ["**/*.ts"],
      }),
    );
    for (const rel of globSync(["**/*.ts"], { cwd: strippedDir })) {
      const filePath = join(strippedDir, rel);
      const stripped = readFileSync(filePath, "utf8")
        .replace(/^\/\* eslint-disable \*\/\n/m, "")
        .replace(/^\/\* oxlint-disable \*\/\n/m, "");
      writeFileSync(filePath, stripped, "utf8");
    }
    const lintStripped = Bun.spawnSync(
      [
        join(repoRoot, "node_modules/.bin/oxlint"),
        "--config",
        join(repoRoot, "oxlint.config.ts"),
        strippedDir,
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(
      lintStripped.exitCode,
      `${lintStripped.stdout.toString()}\n${lintStripped.stderr.toString()}`,
    ).toBe(0);
  });
});
