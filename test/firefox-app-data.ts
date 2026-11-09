// macOS 27 denies a bare-exec Firefox < 158 read access to
// ~/Library/Application Support/Firefox unless the responsible parent holds
// kTCCServiceSystemPolicyAppDataDetailed (bug 2069536). Firefox 155 then exits
// with "Could not find profile folder." even when Playwright passes -profile.
//
// TODO(remove-workaround): delete this file once playwright-core bundles Firefox >= 158.
// Still needed as of 2026-10-09 against playwright-core@latest (1.64.0, Firefox 157) and the
// newest alpha (1.65.0-alpha-2026-10-08, still Firefox 157).
// When it's fixed upstream, also remove:
//   - the `provider: playwright({ launchOptions: { env: browserLaunchEnv() } })` override (and the
//     now-unused `browserLaunchEnv` import) in packages/{core,react,vue}/vitest.config.firefox.ts
//   - packages/core/test/regression/firefox-app-data.bun.spec.ts (tests this function directly)

/** `sw_vers` exists on macOS and is absent from the Linux CI image. */
export function isMacOS(): boolean {
  return Bun.which("sw_vers") !== null;
}

export function firefoxAppDataRoot(): string {
  return `${Bun.env["TMPDIR"] ?? "/tmp"}/defjs-firefox-app-data`;
}

export function browserLaunchEnv(
  macos: boolean = isMacOS(),
): { [key: string]: string } | undefined {
  if (!macos) {
    return undefined;
  }

  const root = firefoxAppDataRoot();
  const roaming = `${root}/roaming`;
  const local = `${root}/local`;
  Bun.spawnSync(["mkdir", "-p", roaming, local]);

  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  if (Bun.env["MOZ_APP_DATA"] === undefined) {
    env["MOZ_APP_DATA"] = roaming;
  }
  if (Bun.env["MOZ_LOCAL_APP_DATA"] === undefined) {
    env["MOZ_LOCAL_APP_DATA"] = local;
  }
  return env;
}
