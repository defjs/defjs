import type { Reporter } from "vitest/node";

export interface ReportedTest {
  readonly fullName: string;
  readonly options: { readonly mode: string };
  result(): { readonly state: string };
}

export interface ReportedModule {
  readonly children: { allTests(): Iterable<ReportedTest> };
}

export function collectNotRun(modules: Iterable<ReportedModule>): string[] {
  const names: string[] = [];
  for (const module of modules) {
    for (const entry of module.children.allTests()) {
      if (entry.result().state === "skipped" || entry.options.mode === "todo") {
        names.push(entry.fullName);
      }
    }
  }
  return names;
}

export class NoSkipReporter implements Reporter {
  onTestRunEnd(modules: readonly ReportedModule[]): void {
    const names = collectNotRun(modules);
    if (names.length === 0) {
      return;
    }
    for (const name of names) {
      console.error(`Skipped or todo test: ${name}`);
    }
    process.exitCode = 1;
  }
}
