import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import { browserLaunchEnv } from "../../test/firefox-app-data.ts";
import { baseConfig } from "./vitest.config.ts";

export default mergeConfig(
  baseConfig("firefox"),
  defineConfig({
    test: {
      name: "react-firefox",
      api: { host: "127.0.0.1" },
      browser: {
        enabled: true,
        provider: playwright(),
        connectTimeout: 120_000,
        headless: true,
        screenshotFailures: false,
        instances: [
          {
            browser: "firefox",
            name: "react-firefox",
            provider: playwright({
              launchOptions: { env: browserLaunchEnv() },
            }),
          },
        ],
      },
    },
  }),
);
