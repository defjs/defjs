import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserLaunchEnv } from "../../test/firefox-app-data.ts";
import { packageRoot } from "./test/shared.ts";
import { xsrfProxyPlugin } from "./test/vite-xsrf-plugin.ts";

export default defineConfig({
  root: packageRoot,
  plugins: [xsrfProxyPlugin()],
  test: {
    name: "core-browser",
    // Keep browser navigation on the same IP family as the test server.
    api: { host: "127.0.0.1" },
    browser: {
      enabled: true,
      provider: playwright(),
      connectTimeout: 120_000,
      headless: true,
      screenshotFailures: false,
      instances: [
        {
          browser: "chromium",
          include: ["src/**/*.browser.spec.ts", "src/**/*.chrome.spec.ts"],
        },
        {
          browser: "firefox",
          provider: playwright({ launchOptions: { env: browserLaunchEnv() } }),
          include: ["src/**/*.browser.spec.ts", "src/**/*.firefox.spec.ts"],
        },
      ],
    },
  },
});
