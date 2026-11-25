import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateOpenApi } from "../../index.ts";
import { CliError } from "../../runtime/diagnostics.ts";
import { loadOpenApiDocument } from "./parser/scalar.ts";
import {
  createTempDir,
  getOp,
  isAsyncIterable,
  loadGeneratedModule,
  startLocalServer,
} from "../../../test/helpers.ts";

interface VersionCase {
  readonly field: "swagger" | "openapi";
  readonly rawVersion: string;
  readonly expectedFamily: string;
}

const SUPPORTED_VERSIONS: readonly VersionCase[] = [
  { field: "swagger", rawVersion: "2.0", expectedFamily: "2.0" },
  { field: "openapi", rawVersion: "3.0.0", expectedFamily: "3.0" },
  { field: "openapi", rawVersion: "3.0.1", expectedFamily: "3.0" },
  { field: "openapi", rawVersion: "3.0.2", expectedFamily: "3.0" },
  { field: "openapi", rawVersion: "3.0.3", expectedFamily: "3.0" },
  { field: "openapi", rawVersion: "3.0.4", expectedFamily: "3.0" },
  { field: "openapi", rawVersion: "3.0.0-rc0", expectedFamily: "3.0" },
  { field: "openapi", rawVersion: "3.1.0", expectedFamily: "3.1" },
  { field: "openapi", rawVersion: "3.1.1", expectedFamily: "3.1" },
  { field: "openapi", rawVersion: "3.1.2", expectedFamily: "3.1" },
  { field: "openapi", rawVersion: "3.1.0-rc0", expectedFamily: "3.1" },
  { field: "openapi", rawVersion: "3.2.0", expectedFamily: "3.2" },
  { field: "openapi", rawVersion: "3.2.1", expectedFamily: "3.2" },
  { field: "openapi", rawVersion: "3.2.0-rc0", expectedFamily: "3.2" },
];

function buildSmokeDoc(
  field: "swagger" | "openapi",
  rawVersion: string,
): { [key: string]: unknown } {
  if (field === "swagger") {
    return {
      swagger: rawVersion,
      info: { title: "Swagger 2.0", version: "1.0.0" },
      produces: ["application/json"],
      paths: {
        "/ping": {
          get: {
            tags: ["Health"],
            operationId: "getPing",
            responses: {
              "200": {
                description: "ok",
                schema: { $ref: "#/definitions/PingPayload" },
              },
            },
          },
        },
      },
      definitions: {
        PingPayload: {
          type: "object",
          required: ["version", "nullable_note"],
          properties: {
            version: { type: "string" },
            nullable_note: { type: "string", "x-nullable": true },
          },
        },
      },
    };
  }

  const nullableProp = rawVersion.startsWith("3.0")
    ? { type: "string", nullable: true }
    : { type: ["string", "null"] };

  return {
    openapi: rawVersion,
    info: { title: `OpenAPI ${rawVersion}`, version: "1.0.0" },
    paths: {
      "/ping": {
        get: {
          tags: ["Health"],
          operationId: "getPing",
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PingPayload" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        PingPayload: {
          type: "object",
          required: ["version", "nullable_note"],
          properties: {
            version: { type: "string" },
            nullable_note: nullableProp,
          },
        },
      },
    },
  };
}

describe("@defjs/cli OpenAPI protocol version matrix", () => {
  test("parses, generates, and executes all Swagger/OpenAPI versions supported by @scalar/openapi-parser and rejects unsupported ones", async () => {
    const tmp = createTempDir("defjs-cli-version-matrix-");
    let expectedReplyVersion = "";
    const baseUrl = await startLocalServer(() =>
      Promise.resolve({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: expectedReplyVersion,
          nullable_note: null,
        }),
      }),
    );

    for (const item of SUPPORTED_VERSIONS) {
      const doc = buildSmokeDoc(item.field, item.rawVersion);
      const parsed = await loadOpenApiDocument({ input: doc, cwd: tmp });
      expect(parsed.version).toBe(item.expectedFamily);
      expect(doc[item.field]).toBe(item.rawVersion);

      const safeDirName = `out-${item.field}-${item.rawVersion.replaceAll(/[^a-z0-9]/gi, "_")}`;
      const outDir = join(tmp, safeDirName);
      const gen = await generateOpenApi({
        cwd: tmp,
        target: {
          input: doc,
          output: { dir: outDir, format: "ts" },
        },
      });
      expect(doc[item.field]).toBe(item.rawVersion);
      expect(gen.operationCount).toBe(1);
      expect(gen.schemaCount).toBeGreaterThanOrEqual(1);
      expect(
        readFileSync(join(outDir, "request/health.ts"), "utf8"),
      ).not.toContain("struct.");

      expectedReplyVersion = item.rawVersion;
      const bundle = await loadGeneratedModule(outDir, "index.ts");
      const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));
      const getPing = getOp(bundle.mod, "getPing");
      const [err, data] = await getPing(client);
      expect(err).toBeNull();
      expect(data).toEqual({
        version: item.rawVersion,
        nullableNote: null,
      });
    }

    const unsupportedInputs: readonly { [key: string]: unknown }[] = [
      { swagger: "1.2", info: { title: "S12", version: "1.0" }, paths: {} },
      { swagger: "2.1", info: { title: "S21", version: "1.0" }, paths: {} },
      { openapi: "3.0", info: { title: "O30", version: "1.0" }, paths: {} },
      { openapi: "3.3.0", info: { title: "O33", version: "1.0" }, paths: {} },
      { openapi: "3.10.0", info: { title: "O310", version: "1.0" }, paths: {} },
      { openapi: "4.0.0", info: { title: "O40", version: "1.0" }, paths: {} },
      { info: { title: "NoVersion", version: "1.0" }, paths: {} },
    ];

    for (const badDoc of unsupportedInputs) {
      await expect(
        loadOpenApiDocument({ input: badDoc, cwd: tmp }),
      ).rejects.toThrow(CliError);
    }
  }, 30_000);

  test("supports Swagger 2.0 single-file upgraded and multi-file un-upgraded features end-to-end", async () => {
    const tmp = createTempDir("defjs-cli-sw2-matrix-");
    const observed: {
      method: string;
      url: string;
      contentType: string | undefined;
      bodyText: string;
    }[] = [];

    const baseUrl = await startLocalServer((req) => {
      const contentTypeHeader = req.headers["content-type"];
      observed.push({
        method: req.method,
        url: req.url,
        contentType: Array.isArray(contentTypeHeader)
          ? contentTypeHeader[0]
          : contentTypeHeader,
        bodyText: req.body.toString("utf8"),
      });

      if (req.url.startsWith("/v2/items/404")) {
        return Promise.resolve({
          status: 404,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "NOT_FOUND", message: "Item missing" }),
        });
      }
      if (req.url.startsWith("/v2/items/")) {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: 7, note: null, score: 5 }),
        });
      }
      if (req.url === "/v2/upload-legacy" || req.url === "/multi-upload") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploaded: true }),
        });
      }
      if (req.url === "/download-legacy") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.from([10, 20, 30]),
        });
      }
      if (req.url.startsWith("/multi-items/")) {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "MultiSw2", note: null }),
        });
      }
      return Promise.resolve({ status: 204 });
    });

    // 1. Single-file Swagger 2.0 (host, basePath, schemes, consumes, produces, securityDefinitions, #/parameters/*, #/responses/*, x-nullable, exclusiveMinimum, collectionFormat, body, formData file/urlencoded)
    const singleSw2 = `swagger: "2.0"
info:
  title: Full Swagger 2.0
  version: "1.0.0"
host: api.example.com
basePath: /v2
schemes:
  - https
consumes:
  - application/json
produces:
  - application/json
securityDefinitions:
  ApiKeyAuth:
    type: apiKey
    in: header
    name: X-Api-Key
  LegacyOAuth:
    type: oauth2
    flow: application
    tokenUrl: https://auth.example.com/token
    scopes:
      read: Read
  BasicAuth:
    type: basic
parameters:
  SharedPipes:
    name: tags
    in: query
    type: array
    items:
      type: string
    collectionFormat: pipes
  PathItemId:
    name: item_id
    in: path
    required: true
    type: integer
responses:
  NotFoundResp:
    description: Not found
    schema:
      $ref: "#/definitions/ApiError"
paths:
  /v2/items/{item_id}:
    get:
      tags: [Legacy]
      operationId: getLegacyItem
      parameters:
        - $ref: "#/parameters/PathItemId"
        - $ref: "#/parameters/SharedPipes"
        - in: query
          name: csv_vals
          type: array
          items: { type: string }
          collectionFormat: csv
        - in: query
          name: ssv_vals
          type: array
          items: { type: string }
          collectionFormat: ssv
        - in: query
          name: multi_vals
          type: array
          items: { type: string }
          collectionFormat: multi
      responses:
        "200":
          description: ok
          schema:
            $ref: "#/definitions/LegacyItem"
        "404":
          $ref: "#/responses/NotFoundResp"
  /v2/items:
    post:
      tags: [Legacy]
      operationId: createLegacyItem
      parameters:
        - in: body
          name: body
          required: true
          schema:
            $ref: "#/definitions/LegacyItem"
      responses:
        "204":
          description: created
  /v2/upload-legacy:
    post:
      tags: [Legacy]
      operationId: uploadLegacyFile
      consumes:
        - multipart/form-data
      parameters:
        - in: formData
          name: title
          type: string
          required: true
        - in: formData
          name: attachment
          type: file
          required: true
      responses:
        "200":
          description: ok
          schema:
            type: object
            required: [uploaded]
            properties:
              uploaded: { type: boolean }
  /v2/form-legacy:
    post:
      tags: [Legacy]
      operationId: submitLegacyUrlForm
      consumes:
        - application/x-www-form-urlencoded
      parameters:
        - in: formData
          name: confirm_flag
          type: boolean
          required: true
      responses:
        "204":
          description: ok
definitions:
  LegacyItem:
    type: object
    required: [id, score]
    properties:
      id: { type: integer }
      note: { type: string, x-nullable: true }
      score: { type: number, minimum: 1, exclusiveMinimum: true }
  ApiError:
    type: object
    required: [code, message]
    properties:
      code: { type: string }
      message: { type: string }
`;

    const singleOut = join(tmp, "sw2-single");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: singleSw2,
        output: { dir: singleOut, format: "ts" },
        errorStrategy: "union",
      },
    });
    const singleSchemaCode = readFileSync(
      join(singleOut, "schema/legacy.ts"),
      "utf8",
    );
    expect(singleSchemaCode).toContain("struct.formData(");
    expect(singleSchemaCode).toContain(
      "attachment: /*#__PURE__*/ struct.file()",
    );
    expect(singleSchemaCode).toContain("struct.urlencoded(");
    expect(singleSchemaCode).toContain("exclusiveMinimum: 1");

    const singleBundle = await loadGeneratedModule(singleOut, "index.ts");
    const client = singleBundle.createClientFn(
      singleBundle.withEndpointFn(baseUrl),
    );

    const getLegacyItem = getOp(singleBundle.mod, "getLegacyItem");
    const [okErr, okItem] = await getLegacyItem(client, {
      itemId: 7,
      query: {
        tags: ["a", "b"],
        csvVals: ["c1", "c2"],
        ssvVals: ["s1", "s2"],
        multiVals: ["m1", "m2"],
      },
    });
    expect(okErr).toBeNull();
    expect(okItem).toEqual({ id: 7, note: null, score: 5 });
    const reqUrl = observed.at(-1)?.url ?? "";
    expect(reqUrl).toContain("tags=a%7Cb");
    expect(reqUrl).toContain("csv_vals=c1%2Cc2");
    expect(reqUrl).toContain("ssv_vals=s1+s2");
    expect(reqUrl).toContain("multi_vals=m1&multi_vals=m2");

    const [notFoundErr] = await getLegacyItem(client, { itemId: 404 });
    expect(notFoundErr).toMatchObject({
      code: "HTTP_STATUS",
      status: 404,
      data: { code: "NOT_FOUND", message: "Item missing" },
    });

    const createLegacyItem = getOp(singleBundle.mod, "createLegacyItem");
    const [createErr] = await createLegacyItem(client, {
      body: { id: 1, note: null, score: 10 },
    });
    expect(createErr).toBeNull();

    const uploadLegacyFile = getOp(singleBundle.mod, "uploadLegacyFile");
    const [upErr, upRes] = await uploadLegacyFile(client, {
      body: { title: "doc", attachment: new File(["hello"], "note.txt") },
    });
    expect(upErr).toBeNull();
    expect(upRes).toEqual({ uploaded: true });
    expect(observed.at(-1)?.contentType).toContain("multipart/form-data");

    const submitLegacyUrlForm = getOp(singleBundle.mod, "submitLegacyUrlForm");
    const [formErr] = await submitLegacyUrlForm(client, {
      body: { confirmFlag: true },
    });
    expect(formErr).toBeNull();
    expect(observed.at(-1)?.bodyText).toBe("confirm_flag=true");

    // 2. Multi-file Swagger 2.0 (un-upgraded filesystem: direct param types, collectionFormat, type: "file", x-nullable)
    const multiDir = join(tmp, "sw2-multi-src");
    mkdirSync(multiDir, { recursive: true });
    writeFileSync(
      join(multiDir, "defs.yaml"),
      `LegacyEntity:
  type: object
  required: [title]
  properties:
    title: { type: string }
    note: { type: string, x-nullable: true }
`,
    );
    writeFileSync(
      join(multiDir, "swagger.yaml"),
      `swagger: "2.0"
info:
  title: Multi Swagger 2.0
  version: "1.0.0"
paths:
  /multi-items/{item_id}:
    get:
      tags: [MultiSw2]
      operationId: getMultiSw2Item
      parameters:
        - in: path
          name: item_id
          required: true
          type: integer
        - in: query
          name: q
          type: string
        - in: query
          name: csv_default
          type: array
          items: { type: string }
        - in: query
          name: ssv_arr
          type: array
          items: { type: string }
          collectionFormat: ssv
        - in: query
          name: pipes_arr
          type: array
          items: { type: string }
          collectionFormat: pipes
        - in: query
          name: multi_arr
          type: array
          items: { type: string }
          collectionFormat: multi
      responses:
        "200":
          description: ok
          schema:
            $ref: "./defs.yaml#/LegacyEntity"
  /multi-upload:
    post:
      tags: [MultiSw2]
      operationId: uploadMultiSw2
      consumes: [multipart/form-data]
      parameters:
        - in: formData
          name: doc
          type: file
          required: true
      responses:
        "200":
          description: ok
          schema:
            type: object
            required: [uploaded]
            properties:
              uploaded: { type: boolean }
  /download-legacy:
    get:
      tags: [MultiSw2]
      operationId: downloadMultiSw2
      produces: [application/octet-stream]
      responses:
        "200":
          description: bin
          schema:
            type: file
`,
    );

    const multiParsed = await loadOpenApiDocument({
      input: join(multiDir, "swagger.yaml"),
      cwd: tmp,
    });
    expect(multiParsed.version).toBe("2.0");

    const multiOut = join(tmp, "sw2-multi-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: join(multiDir, "swagger.yaml"),
        output: { dir: multiOut, format: "ts" },
      },
    });

    const multiSchemaCode = readFileSync(
      join(multiOut, "schema/multi-sw-2.ts"),
      "utf8",
    );
    expect(multiSchemaCode).toContain(
      "note: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).nullish()",
    );
    expect(multiSchemaCode).toContain("doc: /*#__PURE__*/ struct.file()");
    expect(multiSchemaCode).toContain(
      "export const DownloadMultiSw2Output = /*#__PURE__*/ struct.blob();",
    );

    const multiBundle = await loadGeneratedModule(multiOut, "index.ts");
    const multiClient = multiBundle.createClientFn(
      multiBundle.withEndpointFn(baseUrl),
    );
    const [mErr, mItem] = await getOp(multiBundle.mod, "getMultiSw2Item")(
      multiClient,
      {
        itemId: 9,
        query: {
          q: "hi",
          csvDefault: ["x", "y"],
          ssvArr: ["a", "b"],
          pipesArr: ["p", "q"],
          multiArr: ["1", "2"],
        },
      },
    );
    expect(mErr).toBeNull();
    expect(mItem).toEqual({ title: "MultiSw2", note: null });
    const multiUrl = observed.at(-1)?.url ?? "";
    expect(multiUrl).toContain("csv_default=x%2Cy");
    expect(multiUrl).toContain("ssv_arr=a+b");
    expect(multiUrl).toContain("pipes_arr=p%7Cq");
    expect(multiUrl).toContain("multi_arr=1&multi_arr=2");

    const [mUpErr, mUpRes] = await getOp(multiBundle.mod, "uploadMultiSw2")(
      multiClient,
      {
        body: { doc: new File(["bytes"], "multi.bin") },
      },
    );
    expect(mUpErr).toBeNull();
    expect(mUpRes).toEqual({ uploaded: true });

    const [dlErr, dlBlob] = await getOp(
      multiBundle.mod,
      "downloadMultiSw2",
    )(multiClient);
    expect(dlErr).toBeNull();
    expect(dlBlob).toBeInstanceOf(Blob);
  });

  test("supports OpenAPI 3.0.x single-file upgraded and multi-file features end-to-end", async () => {
    const tmp = createTempDir("defjs-cli-oa30-matrix-");
    const baseUrl = await startLocalServer((req) => {
      if (req.url === "/oa30/items" && req.method === "POST") {
        if (req.headers["x-fail"] === "1") {
          return Promise.resolve({
            status: 422,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code: "INVALID" }),
          });
        }
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: req.body.toString("utf8"),
        });
      }
      if (req.url === "/oa30/events") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          sseChunks: ['event: message\ndata: {"ok":true}\n\n'],
        });
      }
      if (req.url === "/oa30/upload") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true }),
        });
      }
      if (req.url === "/oa30-multi/item") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: null }),
        });
      }
      return Promise.resolve({ status: 204 });
    });

    const single304 = `openapi: 3.0.4
info:
  title: OpenAPI 3.0.4 Full
  version: 1.0.0
x-webhooks:
  onItemChanged:
    post:
      responses:
        "200": { description: ok }
paths:
  /oa30/items:
    post:
      tags: [Oa30]
      operationId: upsertOa30Item
      parameters:
        - in: header
          name: X-Fail
          required: false
          schema: { type: string }
      requestBody:
        $ref: "#/components/requestBodies/ItemBody"
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Oa30Entity"
        "422":
          $ref: "#/components/responses/UnprocessableError"
  /oa30/upload:
    post:
      tags: [Oa30]
      operationId: uploadOa30File
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file, raw_b64]
              properties:
                file: { type: string, format: binary }
                raw_b64: { type: string, format: byte }
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
  /oa30/events:
    get:
      tags: [Oa30]
      operationId: watchOa30Events
      responses:
        "200":
          description: sse
          content:
            text/event-stream:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }
components:
  schemas:
    Tag:
      type: object
      required: [label]
      properties:
        label: { type: string }
    CatPet:
      type: object
      required: [kind, purrs]
      properties:
        kind: { type: string, enum: ["cat"] }
        purrs: { type: boolean }
    DogPet:
      type: object
      required: [kind, barks]
      properties:
        kind: { type: string, enum: ["dog"] }
        barks: { type: boolean }
    Oa30Entity:
      type: object
      required: [name, score]
      example:
        name: sample
        score: 10
      properties:
        name: { type: string, nullable: true }
        score:
          type: number
          minimum: 0
          exclusiveMinimum: true
          maximum: 100
          exclusiveMaximum: true
        tag_ref:
          $ref: "#/components/schemas/Tag"
          nullable: true
        all_of_nullable:
          allOf:
            - $ref: "#/components/schemas/Tag"
          nullable: true
        union_nullable:
          oneOf:
            - type: string
            - type: integer
          nullable: true
        pet:
          oneOf:
            - $ref: "#/components/schemas/CatPet"
            - $ref: "#/components/schemas/DogPet"
          discriminator:
            propertyName: kind
  requestBodies:
    ItemBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Oa30Entity"
  responses:
    UnprocessableError:
      description: invalid
      content:
        application/json:
          schema:
            type: object
            required: [code]
            properties:
              code: { type: string }
`;

    const outDir = join(tmp, "oa30-single");
    const gen = await generateOpenApi({
      cwd: tmp,
      target: {
        input: single304,
        output: { dir: outDir, format: "ts" },
        errorStrategy: "union",
      },
    });
    expect(gen.diagnostics.map((d) => d.code)).toContain(
      "CLI_UNSUPPORTED_WEBHOOKS",
    );

    const schemaCode = readFileSync(join(outDir, "schema/oa-30.ts"), "utf8");
    expect(schemaCode).toContain("file: /*#__PURE__*/ struct.file()");
    expect(schemaCode).toContain(
      'rawB64: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).alias("raw_b64")',
    );
    expect(schemaCode).toContain("exclusiveMinimum: 0, exclusiveMaximum: 100");
    expect(schemaCode).toContain('struct.discriminatedUnion("kind"');
    expect(schemaCode).toContain(
      '/*#__PURE__*/ (/*#__PURE__*/ Tag.alias("tag_ref")).nullish()',
    );
    expect(schemaCode).toContain(
      '/*#__PURE__*/ (/*#__PURE__*/ Tag.alias("all_of_nullable")).nullish()',
    );

    const bundle = await loadGeneratedModule(outDir, "index.ts");
    const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));

    const upsertOa30Item = getOp(bundle.mod, "upsertOa30Item");
    const [err1, res1] = await upsertOa30Item(client, {
      body: {
        name: null,
        score: 50,
        tagRef: null,
        unionNullable: null,
        pet: { kind: "cat", purrs: true },
      },
    });
    expect(err1).toBeNull();
    expect(res1).toMatchObject({
      name: null,
      score: 50,
      tagRef: null,
      unionNullable: null,
      pet: { kind: "cat", purrs: true },
    });

    const [err422] = await upsertOa30Item(client, {
      headers: { xFail: "1" },
      body: { name: "x", score: 1 },
    });
    expect(err422).toMatchObject({
      code: "HTTP_STATUS",
      status: 422,
      data: { code: "INVALID" },
    });

    const [upErr, upRes] = await getOp(bundle.mod, "uploadOa30File")(client, {
      body: {
        file: new File(["oa30"], "oa30.bin"),
        rawB64: "b2EzMA==",
      },
    });
    expect(upErr).toBeNull();
    expect(upRes).toEqual({ ok: true });

    const [sseErr, stream] = await getOp(bundle.mod, "watchOa30Events")(client);
    expect(sseErr).toBeNull();
    const events: unknown[] = [];
    if (isAsyncIterable(stream)) {
      for await (const ev of stream) {
        events.push(ev);
      }
    }
    expect(events).toEqual([
      { event: "message", data: { ok: true }, id: undefined },
    ]);

    // Multi-file OpenAPI 3.0.4
    const multiDir = join(tmp, "oa30-multi-src");
    mkdirSync(multiDir, { recursive: true });
    writeFileSync(
      join(multiDir, "item.yaml"),
      `type: object
required: [name]
properties:
  name: { type: string, nullable: true }
`,
    );
    writeFileSync(
      join(multiDir, "spec.yaml"),
      `openapi: 3.0.4
info: { title: MultiOa30, version: "1.0.0" }
paths:
  /oa30-multi/item:
    get:
      tags: [Multi30]
      operationId: getMulti30Item
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./item.yaml"
`,
    );
    const multiParsed = await loadOpenApiDocument({
      input: join(multiDir, "spec.yaml"),
      cwd: tmp,
    });
    expect(multiParsed.version).toBe("3.0");
    const multiOut = join(tmp, "oa30-multi-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: join(multiDir, "spec.yaml"),
        output: { dir: multiOut, format: "ts" },
      },
    });
    const multiBundle = await loadGeneratedModule(multiOut, "index.ts");
    const multiClient = multiBundle.createClientFn(
      multiBundle.withEndpointFn(baseUrl),
    );
    const [mErr, mData] = await getOp(
      multiBundle.mod,
      "getMulti30Item",
    )(multiClient);
    expect(mErr).toBeNull();
    expect(mData).toEqual({ name: null });
  });

  test("supports OpenAPI 3.1.x JSON Schema 2020-12 and binary/text contentMediaType rules end-to-end", async () => {
    const tmp = createTempDir("defjs-cli-oa31-matrix-");
    const baseUrl = await startLocalServer((req) => {
      if (req.url === "/oa31/health") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "healthy" }),
        });
      }
      if (req.url === "/oa31/record") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "v31",
            nullable_label: null,
            flex_val: 42,
            pair: ["ok", 2],
            exclusive_score: 99,
            b64_img: "AA==",
            json_str: "{}",
            text_str: "hi",
            problem_str: "{}",
          }),
        });
      }
      if (req.url === "/oa31/upload") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.from([1, 2, 3, 4]),
        });
      }
      if (req.url === "/oa31-multi/pair") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(["multi", 31]),
        });
      }
      return Promise.resolve({ status: 204 });
    });

    const single312 = {
      openapi: "3.1.2",
      info: { title: "OpenAPI 3.1.2 2020-12", version: "1.0.0" },
      jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
      webhooks: {
        assetCreated: {
          post: {
            responses: { "200": { description: "ok" } },
          },
        },
      },
      paths: {
        "/oa31/health": { $ref: "#/components/pathItems/HealthPath" },
        "/oa31/record": {
          post: {
            tags: ["Oa31"],
            operationId: "postOa31Record",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Oa31Payload" },
                },
              },
            },
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Oa31Payload" },
                  },
                },
              },
            },
          },
        },
        "/oa31/upload": {
          post: {
            tags: ["Oa31"],
            operationId: "uploadOa31ContentMedia",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["raw_bin", "typed_bin"],
                    properties: {
                      raw_bin: { contentMediaType: "application/octet-stream" },
                      typed_bin: {
                        type: "string",
                        contentMediaType: "application/octet-stream",
                      },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/octet-stream": {
                    schema: { contentMediaType: "image/png" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        pathItems: {
          HealthPath: {
            get: {
              tags: ["Oa31"],
              operationId: "getOa31Health",
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["status"],
                        properties: { status: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        schemas: {
          BinaryHolder: {
            type: "object",
            properties: {
              untyped_img: { contentMediaType: "image/png" },
              string_img: {
                type: "string",
                contentMediaType: "application/octet-stream",
              },
            },
          },
          Oa31Payload: {
            type: "object",
            required: [
              "kind",
              "nullable_label",
              "flex_val",
              "pair",
              "exclusive_score",
              "b64_img",
              "json_str",
              "text_str",
              "problem_str",
            ],
            properties: {
              kind: { type: "string", const: "v31" },
              nullable_label: { type: ["string", "null"] },
              flex_val: { type: ["string", "number"] },
              pair: {
                type: "array",
                prefixItems: [{ type: "string" }, { type: "integer" }],
                items: false,
              },
              exclusive_score: {
                type: "number",
                exclusiveMinimum: 0,
                exclusiveMaximum: 100,
              },
              b64_img: {
                type: "string",
                contentEncoding: "base64",
                contentMediaType: "image/png",
              },
              json_str: {
                type: "string",
                contentMediaType: "application/json",
              },
              text_str: { type: "string", contentMediaType: "text/plain" },
              problem_str: {
                type: "string",
                contentMediaType: "application/problem+json",
              },
            },
          },
        },
      },
    };

    const outDir = join(tmp, "oa31-single");
    const gen = await generateOpenApi({
      cwd: tmp,
      target: { input: single312, output: { dir: outDir, format: "ts" } },
    });
    expect(gen.diagnostics.map((d) => d.code)).toContain(
      "CLI_UNSUPPORTED_WEBHOOKS",
    );

    const oa31Schema = readFileSync(join(outDir, "schema/oa-31.ts"), "utf8");
    expect(oa31Schema).toContain('struct.literal("v31")');
    expect(oa31Schema).toContain(
      "struct.or(/*#__PURE__*/ struct.string(), /*#__PURE__*/ struct.number())",
    );
    expect(oa31Schema).toContain("struct.tuple([");
    expect(oa31Schema).toContain("exclusiveMinimum: 0, exclusiveMaximum: 100");
    expect(oa31Schema).toContain(
      'b64Img: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).alias("b64_img")',
    );
    expect(oa31Schema).toContain(
      'jsonStr: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).alias("json_str")',
    );
    expect(oa31Schema).toContain(
      'textStr: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).alias("text_str")',
    );
    expect(oa31Schema).toContain(
      'problemStr: /*#__PURE__*/ (/*#__PURE__*/ struct.string()).alias("problem_str")',
    );
    expect(oa31Schema).toContain(
      'rawBin: /*#__PURE__*/ (/*#__PURE__*/ struct.file()).alias("raw_bin")',
    );
    expect(oa31Schema).toContain(
      'typedBin: /*#__PURE__*/ (/*#__PURE__*/ struct.file()).alias("typed_bin")',
    );

    const sharedSchema = readFileSync(join(outDir, "schema/shared.ts"), "utf8");
    expect(sharedSchema).toContain(
      'untypedImg: /*#__PURE__*/ (/*#__PURE__*/ (/*#__PURE__*/ struct.blob()).alias("untyped_img")).optional()',
    );
    expect(sharedSchema).toContain(
      'stringImg: /*#__PURE__*/ (/*#__PURE__*/ (/*#__PURE__*/ struct.blob()).alias("string_img")).optional()',
    );

    const bundle = await loadGeneratedModule(outDir, "index.ts");
    const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));

    const [hErr, hRes] = await getOp(bundle.mod, "getOa31Health")(client);
    expect(hErr).toBeNull();
    expect(hRes).toEqual({ status: "healthy" });

    const [rErr, rRes] = await getOp(bundle.mod, "postOa31Record")(client, {
      body: {
        kind: "v31",
        nullableLabel: null,
        flexVal: 42,
        pair: ["ok", 2],
        exclusiveScore: 99,
        b64Img: "AA==",
        jsonStr: "{}",
        textStr: "hi",
        problemStr: "{}",
      },
    });
    expect(rErr).toBeNull();
    expect(rRes).toEqual({
      kind: "v31",
      nullableLabel: null,
      flexVal: 42,
      pair: ["ok", 2],
      exclusiveScore: 99,
      b64Img: "AA==",
      jsonStr: "{}",
      textStr: "hi",
      problemStr: "{}",
    });

    const [uErr, uBlob] = await getOp(bundle.mod, "uploadOa31ContentMedia")(
      client,
      {
        body: {
          rawBin: new File(["raw"], "raw.bin"),
          typedBin: new File(["typed"], "typed.bin"),
        },
      },
    );
    expect(uErr).toBeNull();
    expect(uBlob).toBeInstanceOf(Blob);

    // Multi-file OpenAPI 3.1.2
    const multiDir = join(tmp, "oa31-multi-src");
    mkdirSync(multiDir, { recursive: true });
    writeFileSync(
      join(multiDir, "tuple.yaml"),
      `type: array
prefixItems:
  - type: string
  - type: integer
items: false
`,
    );
    writeFileSync(
      join(multiDir, "spec.yaml"),
      `openapi: 3.1.2
info: { title: MultiOa31, version: "1.0.0" }
paths:
  /oa31-multi/pair:
    get:
      tags: [Multi31]
      operationId: getMulti31Pair
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./tuple.yaml"
`,
    );
    const multiParsed = await loadOpenApiDocument({
      input: join(multiDir, "spec.yaml"),
      cwd: tmp,
    });
    expect(multiParsed.version).toBe("3.1");
    const multiOut = join(tmp, "oa31-multi-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: join(multiDir, "spec.yaml"),
        output: { dir: multiOut, format: "ts" },
      },
    });
    const multiBundle = await loadGeneratedModule(multiOut, "index.ts");
    const multiClient = multiBundle.createClientFn(
      multiBundle.withEndpointFn(baseUrl),
    );
    const [mErr, mData] = await getOp(
      multiBundle.mod,
      "getMulti31Pair",
    )(multiClient);
    expect(mErr).toBeNull();
    expect(mData).toEqual(["multi", 31]);
  });

  test("supports OpenAPI 3.2.x (QUERY method, additionalOperations, querystring, itemSchema, components.mediaTypes) end-to-end", async () => {
    const tmp = createTempDir("defjs-cli-oa32-matrix-");
    const observed: { method: string; url: string; bodyText: string }[] = [];

    const baseUrl = await startLocalServer((req) => {
      observed.push({
        method: req.method,
        url: req.url,
        bodyText: req.body.toString("utf8"),
      });

      if (req.url === "/search32" && req.method === "QUERY") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: req.body.toString("utf8"),
        });
      }
      if (req.url === "/cache32/item-a" && req.method === "PURGE") {
        return Promise.resolve({ status: 204 });
      }
      if (req.url.startsWith("/qs-req") || req.url.startsWith("/qs-opt")) {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true }),
        });
      }
      if (req.url === "/stream32") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          sseChunks: ['event: tick\ndata: {"seq":1}\n\n'],
        });
      }
      if (req.url === "/multi32/ping") {
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "oa32" }),
        });
      }
      return Promise.resolve({ status: 204 });
    });

    const spec321 = {
      openapi: "3.2.1",
      $self: "https://api.example.com/openapi321.json",
      info: { title: "OpenAPI 3.2.1 Features", version: "1.0.0" },
      tags: [
        { name: "root", summary: "Root group" },
        { name: "Oa32", parent: "root", kind: "nav" },
      ],
      paths: {
        "/search32": {
          query: {
            tags: ["Oa32"],
            operationId: "queryRecords",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  $ref: "#/components/mediaTypes/SearchMedia",
                },
              },
            },
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    $ref: "#/components/mediaTypes/SearchMedia",
                  },
                },
              },
            },
          },
        },
        "/cache32/{key}": {
          additionalOperations: {
            PURGE: {
              tags: ["Oa32"],
              operationId: "purgeCacheKey",
              parameters: [
                {
                  in: "path",
                  name: "key",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: { "204": { description: "purged" } },
            },
          },
        },
        "/qs-req": {
          get: {
            tags: ["Oa32"],
            operationId: "searchQuerystringRequired",
            parameters: [
              {
                name: "qs",
                in: "querystring",
                required: true,
                description: "URL-encoded querystring payload",
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      required: ["q"],
                      properties: {
                        q: { type: "string" },
                        sort_by: { type: "string" },
                      },
                    },
                  },
                },
              },
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["ok"],
                      properties: { ok: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
        },
        "/qs-opt": {
          get: {
            tags: ["Oa32"],
            operationId: "searchQuerystringOptional",
            parameters: [
              {
                name: "qs",
                in: "querystring",
                required: false,
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      properties: { filter_term: { type: "string" } },
                    },
                  },
                },
              },
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["ok"],
                      properties: { ok: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
        },
        "/qs-unsupported": {
          get: {
            tags: ["Oa32"],
            operationId: "searchQuerystringUnsupported",
            parameters: [
              {
                name: "raw_text",
                in: "querystring",
                content: {
                  "text/plain": { schema: { type: "string" } },
                },
              },
            ],
            responses: { "204": { description: "ok" } },
          },
        },
        "/stream32": {
          get: {
            tags: ["Oa32"],
            operationId: "streamOa32",
            responses: {
              "200": {
                description: "stream",
                content: {
                  "text/event-stream": {
                    itemSchema: {
                      type: "object",
                      required: ["event", "data"],
                      properties: {
                        event: { type: "string", const: "tick" },
                        data: {
                          type: "object",
                          required: ["seq"],
                          properties: { seq: { type: "integer" } },
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
      components: {
        mediaTypes: {
          SearchMedia: {
            schema: {
              type: "object",
              required: ["term"],
              properties: {
                term: { type: "string" },
                mode: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["kind"],
                      properties: { kind: { type: "string", const: "fast" } },
                    },
                    {
                      type: "object",
                      required: ["kind"],
                      properties: { kind: { type: "string", const: "deep" } },
                    },
                  ],
                  discriminator: {
                    propertyName: "kind",
                    defaultMapping: "fast",
                  },
                },
              },
              example: { dataValue: { term: "hello" } },
            },
          },
        },
      },
    };

    const outDir = join(tmp, "oa32-single");
    const gen = await generateOpenApi({
      cwd: tmp,
      target: { input: spec321, output: { dir: outDir, format: "ts" } },
    });
    const qsWarnings = gen.diagnostics.filter(
      (d) => d.code === "CLI_UNSUPPORTED_QUERYSTRING_PARAM",
    );
    expect(qsWarnings).toHaveLength(1);
    expect(qsWarnings[0]?.message).toContain('"text/plain"');

    const oa32Req = readFileSync(join(outDir, "request/oa-32.ts"), "utf8");
    expect(oa32Req).toContain('method: "QUERY"');
    expect(oa32Req).toContain('method: "PURGE"');
    expect(oa32Req).toContain("query: input.query");
    expect(oa32Req).toContain("query: input?.query");

    const bundle = await loadGeneratedModule(outDir, "index.ts");
    const client = bundle.createClientFn(bundle.withEndpointFn(baseUrl));

    const [qErr, qRes] = await getOp(bundle.mod, "queryRecords")(client, {
      body: { term: "defjs", mode: { kind: "fast" } },
    });
    expect(qErr).toBeNull();
    expect(qRes).toEqual({ term: "defjs", mode: { kind: "fast" } });
    expect(observed.at(-1)?.method).toBe("QUERY");

    const [pErr] = await getOp(bundle.mod, "purgeCacheKey")(client, {
      key: "item-a",
    });
    expect(pErr).toBeNull();
    expect(observed.at(-1)?.method).toBe("PURGE");

    const [qsReqErr, qsReqRes] = await getOp(
      bundle.mod,
      "searchQuerystringRequired",
    )(client, {
      query: { q: "books", sortBy: "asc" },
    });
    expect(qsReqErr).toBeNull();
    expect(qsReqRes).toEqual({ ok: true });
    expect(observed.at(-1)?.url).toContain("/qs-req?q=books&sort_by=asc");

    const searchQsOpt = getOp(bundle.mod, "searchQuerystringOptional");
    const [qsOptNoneErr] = await searchQsOpt(client);
    expect(qsOptNoneErr).toBeNull();
    const [qsOptErr] = await searchQsOpt(client, {
      query: { filterTerm: "new" },
    });
    expect(qsOptErr).toBeNull();
    expect(observed.at(-1)?.url).toContain("/qs-opt?filter_term=new");

    const [sseErr, stream] = await getOp(bundle.mod, "streamOa32")(client);
    expect(sseErr).toBeNull();
    const items: unknown[] = [];
    if (isAsyncIterable(stream)) {
      for await (const ev of stream) {
        items.push(ev);
      }
    }
    expect(items).toEqual([{ event: "tick", data: { seq: 1 }, id: undefined }]);

    // Multi-file OpenAPI 3.2.0
    const multiDir = join(tmp, "oa32-multi-src");
    mkdirSync(multiDir, { recursive: true });
    writeFileSync(
      join(multiDir, "ping.yaml"),
      `type: object
required: [id]
properties:
  id: { type: string }
`,
    );
    writeFileSync(
      join(multiDir, "spec.yaml"),
      `openapi: 3.2.0
info: { title: MultiOa32, version: "1.0.0" }
paths:
  /multi32/ping:
    get:
      tags: [Multi32]
      operationId: pingMulti32
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./ping.yaml"
`,
    );
    const multiParsed = await loadOpenApiDocument({
      input: join(multiDir, "spec.yaml"),
      cwd: tmp,
    });
    expect(multiParsed.version).toBe("3.2");
    const multiOut = join(tmp, "oa32-multi-out");
    await generateOpenApi({
      cwd: tmp,
      target: {
        input: join(multiDir, "spec.yaml"),
        output: { dir: multiOut, format: "ts" },
      },
    });
    const multiBundle = await loadGeneratedModule(multiOut, "index.ts");
    const multiClient = multiBundle.createClientFn(
      multiBundle.withEndpointFn(baseUrl),
    );
    const [mErr, mRes] = await getOp(
      multiBundle.mod,
      "pingMulti32",
    )(multiClient);
    expect(mErr).toBeNull();
    expect(mRes).toEqual({ id: "oa32" });
  });
});
