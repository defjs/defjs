import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// macOS 27 denies a bare-exec Firefox < 158 read access to
// ~/Library/Application Support/Firefox unless the responsible parent holds
// kTCCServiceSystemPolicyAppDataDetailed (bug 2069536). Firefox 155 then exits
// with "Could not find profile folder." even when Playwright passes -profile.
//
// TODO(remove-workaround): delete this file once playwright-core bundles Firefox >= 158.
// Check with: bun -e "console.log(require('playwright-core/browsers.json').browsers.find(b=>b.name==='firefox'))"
// Still needed as of 2026-10-09 against playwright-core@latest (1.64.0, Firefox 157) and the
// newest alpha (1.65.0-alpha-2026-10-08, still Firefox 157).
// When it's fixed upstream, also remove:
//   - the `provider: playwright({ launchOptions: { env: browserLaunchEnv() } })` override (and the
//     now-unused `browserLaunchEnv` import) in packages/{core,react,vue}/vitest.config.browser.ts
//   - packages/core/test/regression/firefox-app-data.spec.ts (tests this function directly)
export function browserLaunchEnv(): { [key: string]: string } | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }

  const root = join(tmpdir(), "defjs-firefox-app-data");
  const roaming = join(root, "roaming");
  const local = join(root, "local");
  mkdirSync(roaming, { recursive: true });
  mkdirSync(local, { recursive: true });

  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  if (!("MOZ_APP_DATA" in process.env)) {
    env["MOZ_APP_DATA"] = roaming;
  }
  if (!("MOZ_LOCAL_APP_DATA" in process.env)) {
    env["MOZ_LOCAL_APP_DATA"] = local;
  }
  return env;
}
