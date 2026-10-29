import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const docRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: docRoot,
  resolve: { tsconfigPaths: true },
  test: {
    name: "doc-unit",
    pool: "threads",
    include: ["{app,scripts,examples}/**/*.spec.{ts,tsx}"],
  },
});
