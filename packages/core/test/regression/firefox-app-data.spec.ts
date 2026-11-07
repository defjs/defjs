import { expect, test } from "vitest";
import {
  browserLaunchEnv,
  firefoxAppDataRoot,
  isMacOS,
} from "../../../../test/firefox-app-data";

test("isolates the Firefox workaround and leaves the non-macOS branch untouched", () => {
  const before = { ...Bun.env };
  const env = browserLaunchEnv();
  expect(JSON.stringify(Bun.env) === JSON.stringify(before)).toBe(true);
  if (isMacOS()) {
    expect(env?.["MOZ_APP_DATA"]).toBe(
      before["MOZ_APP_DATA"] ?? `${firefoxAppDataRoot()}/roaming`,
    );
    expect(env?.["MOZ_LOCAL_APP_DATA"]).toBeTruthy();
  }
  expect(browserLaunchEnv(false)).toBeUndefined();
  expect(JSON.stringify(Bun.env) === JSON.stringify(before)).toBe(true);
});
