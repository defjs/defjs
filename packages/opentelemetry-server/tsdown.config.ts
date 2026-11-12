import { defineConfig, type UserConfig } from "tsdown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeDistPackageJson(): Promise<void> {
  const packageJson: unknown = await Bun.file(
    new URL("./package.json", import.meta.url),
  ).json();
  if (!isRecord(packageJson)) {
    throw new TypeError("package.json must contain a JSON object");
  }

  packageJson["main"] = "./index.js";
  packageJson["module"] = "./index.js";
  packageJson["types"] = "./index.d.ts";
  packageJson["typings"] = "./index.d.ts";
  packageJson["exports"] = {
    "./package.json": "./package.json",
    ".": {
      types: "./index.d.ts",
      default: "./index.js",
    },
  };
  delete packageJson["scripts"];
  delete packageJson["devDependencies"];

  await Bun.write(
    new URL("./dist/package.json", import.meta.url),
    `${JSON.stringify(packageJson, undefined, 2)}\n`,
  );
}

export default defineConfig({
  format: "esm",
  outDir: "dist",
  platform: "neutral",
  target: false,
  tsconfig: "tsconfig.build.json",
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
  },
  inputOptions: {
    resolve: {
      mainFields: ["module", "main"],
    },
  },
  deps: {
    neverBundle: [
      "@defjs/core",
      "@opentelemetry/api",
      "@opentelemetry/api-logs",
      "@opentelemetry/core",
    ],
  },
  copy: ["../../LICENSE", "./README.md"],
  hooks: {
    async "build:done"() {
      await writeDistPackageJson();
    },
  },
} satisfies UserConfig);
