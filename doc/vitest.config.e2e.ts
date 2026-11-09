import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { reporters } from "../test/vitest-shared.ts";
import {
  e2eCall,
  e2eClose,
  e2eExtend,
  e2eOpen,
} from "./e2e/support/commands.ts";
import { docRoot } from "./vitest.config.ts";

export default defineConfig({
  root: docRoot,
  define: {
    "import.meta.env.SITE_URL": JSON.stringify("http://localhost:3000"),
  },
  test: {
    name: "doc-e2e",
    // Browser dependency scanning globs the project include; keep it off the Bun-only unit specs.
    include: ["e2e/**/*.chrome.spec.ts"],
    // Keep browser navigation on the same IP family as the static site server.
    api: { host: "127.0.0.1" },
    globalSetup: [
      "./e2e/support/global-setup.ts",
      "../test/runtime-guard-setup.ts",
    ],
    reporters,
    testTimeout: 120_000,
    browser: {
      enabled: true,
      provider: playwright(),
      connectTimeout: 120_000,
      headless: true,
      screenshotFailures: false,
      commands: { e2eOpen, e2eCall, e2eExtend, e2eClose },
      instances: [
        {
          browser: "chromium",
          name: "doc-e2e",
          include: ["e2e/**/*.chrome.spec.ts"],
        },
      ],
    },
  },
});
