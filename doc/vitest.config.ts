import { defineConfig } from "vitest/config";
import { docRoot } from "./vitest.config.unit.ts";
import { resolve } from "node:path";

/**
 * Documentation test aggregator: `doc-unit` runs in the Bun process and carries the coverage gate;
 * `doc-e2e` drives the built static site in Chromium and needs a fresh `bun run build`.
 */
export default defineConfig({
  root: docRoot,
  test: {
    coverage: {
      enabled: false,
      provider: "istanbul",
      reporter: ["lcov", "json", "html", "text"],
      reportsDirectory: resolve(docRoot, "coverage"),
      include: ["app/lib/**/*.ts", "app/data/**/*.ts", "scripts/**/*.ts"],
      exclude: [
        // Evaluated only by the fumadocs-mdx build: `defineDocs` and the content loader need generated sources.
        "app/lib/source.ts",
        "**/*.d.ts",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    projects: ["./vitest.config.unit.ts", "./vitest.config.e2e.ts"],
  },
});
