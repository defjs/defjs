import {
  defineConfig,
  generateOpenApi,
  runCli,
  type DefjsConfig,
  type OpenApiGenerateResult,
  type OpenApiInput,
  type OpenApiTargetConfig,
} from "./index.ts";

const docObject: OpenApiInput = {
  openapi: "3.1.0",
  info: { title: "Demo", version: "1.0.0" },
  paths: {},
};

const asyncLoader: OpenApiInput = () =>
  Promise.resolve({
    openapi: "3.1.0",
    info: { title: "Async", version: "1.0.0" },
    paths: {},
  });

export const singleConfig: DefjsConfig = defineConfig({
  openapi: {
    input: docObject,
    output: { dir: "./src/api" },
  },
});

export const arrayConfig: DefjsConfig = defineConfig({
  openapi: [
    {
      input: "./openapi/orders.yaml",
      output: { dir: "./src/orders", format: "ts" },
      mode: "sync",
      errorStrategy: "none",
      mixed2xxStrategy: "omit",
    },
    {
      input: asyncLoader,
      output: { dir: "./src/events", format: "mjs", coreImport: "@defjs/core" },
      mode: "scaffold",
      errorStrategy: "union",
      mixed2xxStrategy: "split",
      include: ["streamEvents"],
      exclude: ["GET /health"],
    },
  ],
});

const targetCheck: OpenApiTargetConfig = {
  input: docObject,
  output: { dir: "./out", format: "tsx" },
};

export function executeTypeChecks(): readonly [
  Promise<OpenApiGenerateResult>,
  Promise<number>,
] {
  return [
    generateOpenApi({ target: targetCheck, check: true }),
    runCli(["openapi", "--help"]),
  ];
}

export const invalidConfigs = [
  defineConfig({
    // @ts-expect-error OpenAPI input must be a string, object, or loader function.
    openapi: { input: 42, output: { dir: "./out" } },
  }),
  defineConfig({
    // @ts-expect-error Output format only permits ts, tsx, js, and mjs.
    openapi: { input: "./a.yaml", output: { dir: "./out", format: "cjs" } },
  }),
  defineConfig({
    // @ts-expect-error Generation mode only permits sync and scaffold.
    openapi: {
      input: "./a.yaml",
      output: { dir: "./out" },
      mode: "overwrite",
    },
  }),
  defineConfig({
    // @ts-expect-error Error strategy only permits none and union.
    openapi: {
      input: "./a.yaml",
      output: { dir: "./out" },
      errorStrategy: "strict",
    },
  }),
  defineConfig({
    // @ts-expect-error Mixed 2xx strategy only permits omit and split.
    openapi: {
      input: "./a.yaml",
      output: { dir: "./out" },
      mixed2xxStrategy: "merge",
    },
  }),
];
