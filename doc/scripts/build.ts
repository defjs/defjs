import { rm } from "node:fs/promises";
import { join } from "node:path";
import { locales } from "../app/lib/i18n";
import { buildFingerprint, writeBuildStamp } from "./build-state";
import { checkLinks } from "./check-links";
export async function finalizeBuild(
  directory: string,
  before: string,
  after: string,
): Promise<void> {
  if (before !== after)
    throw new Error(
      "Documentation inputs changed during build; rebuild before acceptance",
    );
  const notFound = Bun.file(join(directory, "404/index.html"));
  if (!(await notFound.exists())) throw new Error("Missing generated 404 page");
  await Bun.write(join(directory, "404.html"), await notFound.arrayBuffer());
  // React Router also writes a single-fetch .data copy of each resource route; the search client only reads the JSON.
  await Promise.all(
    locales.map((locale) =>
      rm(join(directory, `api/search/${locale}.json.data`), { force: true }),
    ),
  );
  await checkLinks(directory);
  await writeBuildStamp(directory, before);
}
/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) {
  const root = new URL("../", import.meta.url).pathname,
    output = join(root, "build/client");
  await rm(join(output, "build-stamp.txt"), { force: true });
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
