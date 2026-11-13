import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserProject } from "../../test/vitest-shared.ts";
import { xsrfProxyPlugin } from "./test/vite-xsrf-plugin.ts";
import { baseConfig } from "./vitest.config.ts";

export default defineConfig({
  ...baseConfig(browserProject("core", "chrome", playwright())),
  plugins: [xsrfProxyPlugin()],
});
