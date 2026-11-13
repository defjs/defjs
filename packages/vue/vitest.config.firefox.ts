import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { browserLaunchEnv } from "../../test/firefox-app-data.ts";
import { browserProject } from "../../test/vitest-shared.ts";
import { baseConfig } from "./vitest.config.ts";

const provider = playwright({ launchOptions: { env: browserLaunchEnv() } });

export default defineConfig(
  baseConfig(browserProject("vue", "firefox", provider)),
);
