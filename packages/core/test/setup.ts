import type { TestProject } from "vitest/node";
import { assertRuntime, expectedRuntime } from "../../../test/runtime-guard.ts";
import { createFixtureApp } from "./fixture/app.ts";
import { createFixtureLifecycle } from "./fixture/lifecycle.ts";
import { selectStartup } from "./fixture/startup.ts";

const lifecycle = createFixtureLifecycle({
  selectStartup,
  createApp: createFixtureApp,
  createToken: () => crypto.randomUUID(),
  closeTimeoutMs: 10_000,
});

export async function setup(project: Pick<TestProject, "provide" | "name">) {
  assertRuntime(expectedRuntime(project.name));
  return lifecycle.setup(project);
}

export async function teardown(): Promise<void> {
  return lifecycle.teardown();
}
