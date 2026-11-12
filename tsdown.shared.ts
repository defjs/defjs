import type { UserConfig } from "tsdown";

type Manifest = Record<string, unknown>;

/** Bundle options shared by every build of every published package. */
export const bundleOptions = {
  format: "esm",
  outDir: "dist",
  platform: "neutral",
  target: false,
  tsconfig: "tsconfig.build.json",
  inputOptions: {
    resolve: {
      mainFields: ["module", "main"],
    },
  },
} satisfies UserConfig;

// The manifest published from `dist`: the package manifest without its
// development fields, with the entry fields pointing at the built files. The
// entry named `index` is the package root; every other entry is a subpath.
function distManifest(
  manifest: Manifest,
  entry: Record<string, string>,
  fields: Manifest = {},
): Manifest {
  const { scripts, devDependencies, ...published } = manifest;
  const subpaths = Object.keys(entry).map((name) => [
    name === "index" ? "." : `./${name}`,
    { types: `./${name}.d.ts`, default: `./${name}.js` },
  ]);
  return {
    ...published,
    main: "./index.js",
    module: "./index.js",
    types: "./index.d.ts",
    typings: "./index.d.ts",
    exports: {
      "./package.json": "./package.json",
      ...Object.fromEntries(subpaths),
    },
    ...fields,
  };
}

/**
 * The build of a published package: bundles `entry` with declarations into
 * `dist`, copies the license and the README, and writes `dist/package.json`.
 * `fields` are added to that manifest.
 */
export function libraryConfig(
  manifest: Manifest,
  entry: Record<string, string>,
  fields?: Manifest,
): UserConfig {
  return {
    ...bundleOptions,
    clean: true,
    dts: true,
    entry,
    copy: ["../../LICENSE", "./README.md"],
    hooks: {
      "build:done": async ({ options }) => {
        await Bun.write(
          `${options.outDir}/package.json`,
          `${JSON.stringify(distManifest(manifest, entry, fields), undefined, 2)}\n`,
        );
      },
    },
  };
}
