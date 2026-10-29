import type { Page } from "playwright";
import { commands } from "vitest/browser";
import { originOf, remoteOf } from "./support/remote";
import type { Remote } from "./support/remote";

interface Collected {
  values(): string[];
}

export interface Hold {
  release(): void;
}

async function extend(
  name: "errors" | "requests",
  page: Remote<Page>,
  ...options: string[]
): Promise<Remote<Collected>> {
  const { token, ref } = originOf(page);
  return remoteOf<Collected>(
    token,
    await commands.e2eExtend(token, name, ref, ...options),
  );
}

/** Collects page errors and `console.error` output; read them with `.values()` at the end of the test. */
export const captureBrowserErrors = (page: Remote<Page>) =>
  extend("errors", page);

/** Collects the pathnames of requests that start with `prefix`. */
export const captureRequests = (page: Remote<Page>, prefix: string) =>
  extend("requests", page, prefix);

/** Pauses every request matching `url` until `release()` is called. */
export async function holdRequests(
  page: Remote<Page>,
  url: RegExp,
): Promise<Remote<Hold>> {
  const { token, ref } = originOf(page);
  const handle = await commands.e2eExtend(token, "hold", ref, {
    __re: [url.source, url.flags],
  });
  return remoteOf<Hold>(token, handle);
}

export async function waitForHydration(page: Remote<Page>): Promise<void> {
  await page.locator('body[data-hydrated="true"]').waitFor();
}

export async function selectSearchResult(page: Remote<Page>): Promise<void> {
  const dialog = page.getByRole("dialog");
  const id = await dialog
    .getByRole("option", { selected: true })
    .getAttribute("id");
  if (!id?.startsWith("fd-search-option-"))
    throw new Error("Search result has no destination");
  const destination = new URL(
    id.slice("fd-search-option-".length),
    await page.url(),
  ).href;
  await dialog.locator("input").press("Enter");
  await page.waitForURL(destination);
  await dialog.waitFor({ state: "hidden" });
}
