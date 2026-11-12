import { defineConfig } from "vitest/config";
import { serverProject } from "../../test/vitest-shared.ts";
import { baseConfig } from "./vitest.config.ts";

export default defineConfig(
  baseConfig(serverProject("opentelemetry-server", "node")),
);
