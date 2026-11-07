import type { TestProject } from "vitest/node";
import { assertFreshBuild, buildFingerprint } from "../../scripts/build-state";
import { startStaticSite } from "./static-site";

const directory = `${import.meta.dirname}/../../build/client`;

export default async function setup(project: TestProject) {
  await assertFreshBuild(directory, await buildFingerprint());
  const server = startStaticSite(directory);
  project.provide("siteUrl", server.url.href);
  return async () => {
    await server.stop(true);
  };
}
