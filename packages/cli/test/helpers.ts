import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { onTestFinished } from "vitest";
import { createServer as createViteServer } from "vite";
import { isRecord, isUnknownFunction } from "../src/runtime/diagnostics.ts";

export const repoRoot = resolve(import.meta.dirname, "../../..");
export const coreSrcDir = join(repoRoot, "packages/core/src");

export function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export function createIoRecorder(
  cwd: string,
  fetchFn?: (url: string) => Promise<Response>,
) {
  let stdoutText = "";
  let stderrText = "";
  return {
    io: {
      cwd,
      stdout: (chunk: string) => {
        stdoutText += chunk;
      },
      stderr: (chunk: string) => {
        stderrText += chunk;
      },
      ...(fetchFn ? { fetch: fetchFn } : {}),
    },
    get stdout() {
      return stdoutText;
    },
    get stderr() {
      return stderrText;
    },
  };
}

export type DynamicOperation = (
  client: unknown,
  ...args: readonly unknown[]
) => Promise<readonly unknown[]>;

export interface LoadedGeneratedBundle {
  readonly mod: { [key: string]: unknown };
  readonly createClientFn: (...plugins: readonly unknown[]) => unknown;
  readonly withEndpointFn: (endpoint: string) => unknown;
}

export async function loadGeneratedModule(
  rootDir: string,
  entryRelPath: string,
): Promise<LoadedGeneratedBundle> {
  const server = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    resolve: {
      alias: {
        "@defjs/core": coreSrcDir,
      },
    },
  });
  onTestFinished(async () => {
    await server.close();
  });
  const coreMod: unknown = await server.ssrLoadModule(
    join(coreSrcDir, "index.ts"),
  );
  const loaded: unknown = await server.ssrLoadModule(
    join(rootDir, entryRelPath),
  );
  if (!isRecord(coreMod) || !isRecord(loaded)) {
    throw new Error(`Expected module objects for ${entryRelPath}`);
  }
  const createClientFn = coreMod["createClient"];
  const withEndpointFn = coreMod["withEndpoint"];
  if (
    !isUnknownFunction(createClientFn) ||
    !isUnknownFunction(withEndpointFn)
  ) {
    throw new Error("Missing createClient or withEndpoint in loaded core");
  }
  return {
    mod: loaded,
    createClientFn,
    withEndpointFn,
  };
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof Reflect.get(value, Symbol.asyncIterator) === "function"
  );
}

export function getOp(
  mod: { [key: string]: unknown },
  name: string,
): DynamicOperation {
  const fn = mod[name];
  if (!isUnknownFunction(fn)) {
    throw new Error(`Operation "${name}" not exported`);
  }
  return async (client, ...args) => {
    const result: unknown = await fn(client, ...args);
    if (!isUnknownArray(result)) {
      throw new Error(`Expected Defjs tuple from "${name}"`);
    }
    return result;
  };
}

export async function startLocalServer(
  handler: (req: {
    method: string;
    url: string;
    headers: { [key: string]: string | string[] | undefined };
    body: Buffer;
  }) => Promise<{
    status: number;
    headers?: { [key: string]: string };
    body?: string | Buffer;
    sseChunks?: readonly string[];
  }>,
): Promise<string> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      void handler({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks),
      }).then((reply) => {
        res.writeHead(reply.status, reply.headers);
        if (reply.sseChunks) {
          for (const chunk of reply.sseChunks) {
            res.write(chunk);
          }
          res.end();
        } else {
          res.end(reply.body ?? "");
        }
      });
    });
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  onTestFinished(
    () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  );

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Expected TCP server address");
  }
  return `http://127.0.0.1:${addr.port}`;
}
