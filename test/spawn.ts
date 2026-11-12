export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command to completion and returns its exit code and output. */
export async function run(
  cmd: string[],
  options: { cwd: string; env?: Record<string, string>; timeout?: number },
): Promise<RunResult> {
  const child = Bun.spawn(cmd, { ...options, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

/** The environment for a nested Vitest process: the outer run's `VITEST*` variables would change it. */
export function envWithoutVitest(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("VITEST")) continue;
    env[key] = value;
  }
  return env;
}
