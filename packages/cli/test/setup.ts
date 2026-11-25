import type { TestProject } from "vitest/node";
import { assertRuntime, expectedRuntime } from "../../../test/runtime-guard.ts";

export function setup(project: Pick<TestProject, "name">): void {
  assertRuntime(expectedRuntime(project.name));
}
