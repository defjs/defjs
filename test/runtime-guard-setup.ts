import type { TestProject } from "vitest/node";
import { assertRuntime, expectedRuntime } from "./runtime-guard.ts";

export function setup(project: Pick<TestProject, "name">): void {
  assertRuntime(expectedRuntime(project.name));
}
