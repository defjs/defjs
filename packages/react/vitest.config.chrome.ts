import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserProject } from "../../test/vitest-shared.ts";
import { baseConfig } from "./vitest.config.ts";

export default defineConfig(
  baseConfig(browserProject("react", "chrome", playwright())),
);
