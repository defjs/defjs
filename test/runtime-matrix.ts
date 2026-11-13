import type { Runtime } from "./spec-matrix.ts";

export interface Workspace {
  /** Prefix of the project names: `<name>-<runtime>`. */
  readonly name: string;
  /** Directory that holds the workspace's Vitest configs, from the repository root. */
  readonly cwd: string;
  /** Directories, from the repository root, whose specs the workspace runs. */
  readonly dirs: readonly string[];
  readonly runtimes: readonly Runtime[];
}

export interface Project {
  readonly cwd: string;
  readonly runtime: Runtime;
  readonly name: string;
  readonly config: string;
}

// The expected package x runtime table. The Vitest configs do not import it:
// the root specs compare what the configs and the package scripts do with it.
export const workspaces: readonly Workspace[] = [
  {
    name: "core",
    cwd: "packages/core",
    dirs: ["packages/core/"],
    runtimes: ["chrome", "firefox", "node", "bun"],
  },
  {
    name: "react",
    cwd: "packages/react",
    dirs: ["packages/react/"],
    runtimes: ["chrome", "firefox"],
  },
  {
    name: "vue",
    cwd: "packages/vue",
    dirs: ["packages/vue/"],
    runtimes: ["chrome", "firefox"],
  },
  {
    name: "opentelemetry-server",
    cwd: "packages/opentelemetry-server",
    dirs: ["packages/opentelemetry-server/"],
    runtimes: ["node", "bun"],
  },
  {
    name: "doc",
    cwd: "doc",
    dirs: ["doc/app/", "doc/scripts/", "doc/examples/"],
    runtimes: ["bun"],
  },
  { name: "root", cwd: ".", dirs: ["test/"], runtimes: ["bun"] },
];

export const projects: readonly Project[] = workspaces.flatMap(
  ({ name, cwd, runtimes }) =>
    runtimes.map((runtime) => ({
      cwd,
      runtime,
      name: `${name}-${runtime}`,
      config: `vitest.config.${runtime}.ts`,
    })),
);

/** The workspaces with a Node project: `unit:node` runs them and npm installs them. */
export const nodePackages: readonly string[] = workspaces
  .filter(({ runtimes }) => runtimes.includes("node"))
  .map(({ cwd }) => cwd);
