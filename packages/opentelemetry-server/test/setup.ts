import type { TestProject } from "vitest/node";
import { createFixtureApp } from "../../core/test/fixture/app.ts";
import { createFixtureLifecycle } from "../../core/test/fixture/lifecycle.ts";
import type {} from "../../core/test/fixture/provided.ts";
import { selectStartup } from "../../core/test/fixture/startup.ts";
import { assertRuntime, expectedRuntime } from "../../../test/runtime-guard.ts";
import { createOtelFixtureApp } from "./fixture-app.ts";

const lifecycle = createFixtureLifecycle({
  selectStartup,
  createApp: (deps) => {
    const app = createOtelFixtureApp({
      upgradeWebSocket: deps.upgradeWebSocket,
    });
    const fixtureApp = createFixtureApp(deps);
    app.all("/__fixture/*", (c) => fixtureApp.fetch(c.req.raw, c.env));
    return app;
  },
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
