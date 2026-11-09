import { defineConfig, mergeConfig } from "vitest/config";
import { baseConfig } from "./vitest.config.ts";

export default mergeConfig(
  baseConfig("bun"),
  defineConfig({
    test: {
      name: "core-bun",
      pool: "threads",
    },
  }),
);
