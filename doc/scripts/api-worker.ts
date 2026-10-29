import { execFileSync, spawn } from "node:child_process";
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

export async function collectProcess(
  command: string,
  args: readonly string[],
  input: string,
  cwd: string,
): Promise<ProcessResult> {
  const child = spawn(command, [...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = defined(child.stdout, "stdout");
  const stderr = defined(child.stderr, "stderr");
  const stdin = defined(child.stdin, "stdin");
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => out.push(chunk));
  stderr.on("data", (chunk: Buffer) => err.push(chunk));
  const closed = new Promise<ProcessResult>((resolve) => {
    let settled = false;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", (error) =>
      finish({ code: null, stdout: "", stderr: error.message }),
    );
    child.on("close", (code) =>
      finish({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });
  stdin.end(input);
  return closed;
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
      execFileSync(binary, ["-p", "typeof Bun"], {
        encoding: "utf8",
      }).trim() === "undefined"
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

export function nodeBinary(): string {
  if (cachedNode === undefined) {
    cachedNode = selectNodeBinary(
      nodeCandidates(
        execFileSync("/usr/bin/which", ["-a", "node"], { encoding: "utf8" }),
      ),
    );
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`expected ${label} object`);
  return value as Record<string, unknown>;
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
  };
  const typeHref = textField(record, "typeHref");
  if (typeHref) entry.typeHref = typeHref;
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
