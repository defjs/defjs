import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserLaunchEnv } from "../../test/firefox-app-data.ts";
import { packageRoot } from "./test/shared.ts";

export default defineConfig({
  root: packageRoot,
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  resolve: {
    alias: {
      "@defjs/core": resolve(packageRoot, "../core/src"),
    },
  },
  test: {
    api: { host: "127.0.0.1" },
    name: "vue-browser",
    globalSetup: resolve(packageRoot, "../../test/browser-api-server-setup.ts"),
    browser: {
      enabled: true,
      provider: playwright(),
      connectTimeout: 120_000,
      headless: true,
      screenshotFailures: false,
      instances: [
        {
          browser: "chromium",
          include: [
            "src/**/*.browser.spec.ts",
            "src/**/*.chrome.spec.ts",
            "test/core.spec.ts",
          ],
        },
        {
          browser: "firefox",
          provider: playwright({ launchOptions: { env: browserLaunchEnv() } }),
          include: [
            "src/**/*.browser.spec.ts",
            "src/**/*.firefox.spec.ts",
            "test/core.spec.ts",
          ],
        },
      ],
    },
  },
});
