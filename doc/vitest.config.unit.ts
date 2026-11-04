import { defineConfig } from "vitest/config";

export const docRoot = import.meta.dirname;

export default defineConfig({
  root: docRoot,
  resolve: { tsconfigPaths: true },
  test: {
    name: "doc-unit",
    pool: "threads",
    include: ["{app,scripts,examples}/**/*.spec.{ts,tsx}"],
  },
});
