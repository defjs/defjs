import type { TestProject } from "vitest/node";
import type { FixtureAppDeps } from "./app.ts";
import type {} from "./provided.ts";
import { createRawHandler } from "./raw-scenarios.ts";
import type { HttpApp, StartedServer, StartupLayer } from "./startup.ts";
import type { FixtureRegistry } from "./state.ts";
import { createFixtureRegistry } from "./state.ts";

export interface FixtureLifecycleDeps {
  selectStartup(): Promise<StartupLayer>;
  createApp(deps: FixtureAppDeps): HttpApp;
  createToken(): string;
  closeTimeoutMs: number;
}

export interface FixtureLifecycle {
  setup(project: Pick<TestProject, "provide" | "name">): Promise<void>;
  teardown(): Promise<void>;
}

interface Session {
  readonly registry: FixtureRegistry;
  readonly http: StartedServer;
  readonly raw: StartedServer;
}

export function createFixtureLifecycle(
  deps: FixtureLifecycleDeps,
): FixtureLifecycle {
  let session: Session | undefined;

  return {
    async setup(project) {
      if (session !== undefined) return;
      session = await open(deps, project);
    },
    async teardown() {
      const current = session;
      if (current === undefined) return;
      session = undefined;
      const failures: Error[] = [];
      // A rejected step must not skip the remaining closes.
      await runStep(
        "Fixture registry",
        () => current.registry.closeAll(),
        failures,
        deps.closeTimeoutMs,
      );
      await runStep(
        "HTTP server",
        () => current.http.close(),
        failures,
        deps.closeTimeoutMs,
      );
      await runStep(
        "Raw server",
        () => current.raw.close(),
        failures,
        deps.closeTimeoutMs,
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, "Test server teardown failed");
      }
    },
  };
}

async function open(
  deps: FixtureLifecycleDeps,
  project: Pick<TestProject, "provide" | "name">,
): Promise<Session> {
  const layer = await deps.selectStartup();
  const registry = createFixtureRegistry();
  const token = deps.createToken();
  const raw = await layer.startRaw(createRawHandler(registry));
  try {
    const http = await layer.startHttp(
      deps.createApp({
        upgradeWebSocket: layer.upgradeWebSocket,
        rawOrigin: () => raw.origin,
        registry,
        token,
      }),
    );
    try {
      const refusedOrigin = await layer.reserveRefusedOrigin();
      project.provide("testServerHost", http.origin);
      project.provide("rawServerOrigin", raw.origin);
      project.provide("refusedOrigin", refusedOrigin);
      project.provide("fixtureToken", token);
      return { registry, http, raw };
    } catch (error) {
      await http.close();
      throw error;
    }
  } catch (error) {
    await raw.close();
    throw error;
  }
}

async function runStep(
  label: string,
  operation: () => Promise<void>,
  failures: Error[],
  closeTimeoutMs: number,
): Promise<void> {
  try {
    await withTimeout(operation(), closeTimeoutMs, `${label} close timed out`);
  } catch (cause) {
    failures.push(labeledFailure(`${label} close failed`, cause));
  }
}

async function withTimeout(
  promise: Promise<void>,
  closeTimeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, closeTimeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function labeledFailure(label: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${label}: ${detail}`, { cause });
}
