import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import { baseConfig } from "./vitest.config.ts";

export default mergeConfig(
  baseConfig("chrome"),
  defineConfig({
    test: {
      name: "react-chrome",
      api: { host: "127.0.0.1" },
      browser: {
        enabled: true,
        provider: playwright(),
        connectTimeout: 120_000,
        headless: true,
        screenshotFailures: false,
        instances: [{ browser: "chromium", name: "react-chrome" }],
      },
    },
  }),
);
