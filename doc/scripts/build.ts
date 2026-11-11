import { locales } from "../app/lib/i18n";
import { buildFingerprint } from "./build-state";
import { checkLinks } from "./check-links";
import { joinPath } from "./paths";
export async function finalizeBuild(
  directory: string,
  before: string,
  after: string,
): Promise<void> {
  if (before !== after)
    throw new Error("Documentation inputs changed during build; rebuild");
  const notFound = Bun.file(joinPath(directory, "404/index.html"));
  if (!(await notFound.exists())) throw new Error("Missing generated 404 page");
  await Bun.write(
    joinPath(directory, "404.html"),
    await notFound.arrayBuffer(),
  );
  // React Router also writes a single-fetch .data copy of each resource route; the search client only reads the JSON.
  await Promise.all(
    locales.map(async (locale) => {
      const stale = Bun.file(
        joinPath(directory, `api/search/${locale}.json.data`),
      );
      if (await stale.exists()) await stale.delete();
    }),
  );
  await checkLinks(directory);
}
/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) {
  const root = `${import.meta.dirname}/../`,
    output = joinPath(root, "build/client");
  const before = await buildFingerprint();
  const child = Bun.spawn(["bun", "--bun", "react-router", "build"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited)
    throw new Error("React Router documentation build failed");
  await finalizeBuild(output, before, await buildFingerprint());
}
