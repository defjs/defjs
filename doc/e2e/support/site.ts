import type { Browser } from "playwright";
import { inject, onTestFinished } from "vitest";
import { commands } from "vitest/browser";
import { remoteOf } from "./remote";
import type { Remote } from "./remote";

export interface Site {
  browser: Remote<Browser>;
  /** Absolute URL of a path on the statically served documentation build. */
  url(path: string): string;
}

/** Opens a Playwright session against the statically served documentation build and closes it when the test ends. */
export async function openSite(): Promise<Site> {
  const token = await commands.e2eOpen();
  onTestFinished(async () => {
    await commands.e2eClose(token);
  });
  return {
    browser: remoteOf<Browser>(token, "browser"),
    url: (path) => new URL(path, inject("siteUrl")).href,
  };
}
