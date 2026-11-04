import { defined } from "./api-model";
import type { WorkerEntry } from "./api-model";

export interface WorkerDoc {
  file: string;
  name: string;
  entries: WorkerEntry[];
}

export interface WorkerResult {
  docs: WorkerDoc[];
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function workerFailure(
  code: number | null,
  stderr: string,
  stdout: string,
): string {
  const detail = stderr.trim() || stdout.trim() || "no output";
  return `fumadocs-typescript worker exited ${code ?? "null"}: ${detail}`;
}

export function collectProcess(
  command: string,
  args: readonly string[],
  input: string,
  cwd: string,
): Promise<ProcessResult> {
  try {
    const result = Bun.spawnSync({
      cmd: [command, ...args],
      cwd,
      stdin: new TextEncoder().encode(input),
      stderr: "pipe",
      stdout: "pipe",
    });
    return Promise.resolve({
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    });
  } catch (error) {
    return Promise.resolve({
      code: null,
      stdout: "",
      stderr: String(error),
    });
  }
}

export function nodeCandidates(listed: string): string[] {
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Vitest under Bun puts a `node` shim first on PATH. `typescript/sync` needs real Node. */
export function isRealNode(binary: string): boolean {
  try {
    return (
      Bun.spawnSync([binary, "-p", "typeof Bun"]).stdout.toString().trim() ===
      "undefined"
    );
  } catch {
    return false;
  }
}

export function selectNodeBinary(
  candidates: readonly string[],
  real: (binary: string) => boolean = isRealNode,
): string {
  for (const candidate of candidates) {
    if (real(candidate)) return candidate;
  }
  throw new Error("node binary not found on PATH");
}

let cachedNode: string | undefined;

export function nodeCandidatesFromPath(path: string | undefined): string[] {
  if (path === undefined) return [];
  const found: string[] = [];
  for (const directory of path.split(":")) {
    if (directory.length === 0) continue;
    const candidate = `${directory}/node`;
    if (Bun.file(candidate).size > 0) found.push(candidate);
  }
  return found;
}

export function nodeBinary(): string {
  if (cachedNode === undefined) {
    cachedNode = selectNodeBinary(nodeCandidatesFromPath(Bun.env["PATH"]));
  }
  return cachedNode;
}

export async function defaultRun(
  script: string,
  input: string,
  cwd: string,
): Promise<ProcessResult> {
  return collectProcess(
    nodeBinary(),
    ["--input-type=module", "-e", script],
    input,
    cwd,
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`expected ${label} object`);
  return value;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function asEntry(value: unknown): WorkerEntry {
  const record = asRecord(value, "entry");
  const tags = record["tags"];
  if (!Array.isArray(tags)) throw new Error("expected entry tags");
  const entry: WorkerEntry = {
    name: textField(record, "name"),
    description: textField(record, "description"),
    type: textField(record, "type"),
    simplifiedType: textField(record, "simplifiedType"),
    required: Boolean(record["required"]),
    deprecated: Boolean(record["deprecated"]),
    tags: tags.map((tag) => {
      const item = asRecord(tag, "tag");
      return { name: textField(item, "name"), text: textField(item, "text") };
    }),
    typeHref: textField(record, "typeHref") || undefined,
  };
  return entry;
}

export function parseWorkerJson(stdout: string): WorkerResult {
  const lines = stdout.trim().split("\n");
  let lastError = "no output";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = defined(lines[index], "worker line");
    if (!line.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(line);
      const record = asRecord(value, "worker result");
      const docs = record["docs"];
      if (!Array.isArray(docs)) throw new Error("expected docs array");
      return {
        docs: docs.map((doc) => {
          const item = asRecord(doc, "doc");
          const entries = item["entries"];
          if (!Array.isArray(entries)) throw new Error("expected doc entries");
          return {
            file: textField(item, "file"),
            name: textField(item, "name"),
            entries: entries.map(asEntry),
          };
        }),
      };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  throw new Error(
    `fumadocs-typescript worker returned invalid JSON: ${lastError}`,
  );
}

export async function requestTypeTables(
  script: string,
  payload: unknown,
  cwd: string,
  run: (
    script: string,
    input: string,
    cwd: string,
  ) => Promise<ProcessResult> = defaultRun,
): Promise<WorkerResult> {
  const result = await run(script, JSON.stringify(payload), cwd);
  if (result.code !== 0)
    throw new Error(workerFailure(result.code, result.stderr, result.stdout));
  return parseWorkerJson(result.stdout);
}
