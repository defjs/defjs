import { defineConfig, mergeConfig } from "vitest/config";
import { baseConfig } from "./vitest.config.ts";

export default mergeConfig(
  baseConfig("node"),
  defineConfig({
    test: {
      name: "core-node",
      pool: "threads",
    },
  }),
);
