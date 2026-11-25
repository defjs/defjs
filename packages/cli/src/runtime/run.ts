import type { CliIo } from "./types.ts";

const DEFAULT_IO: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/**
 * Executes the `@defjs/cli` command router with explicit arguments and I/O streams.
 *
 * Calling with no arguments prints top-level help and exits with code `0`.
 *
 * @param argv - Command-line arguments excluding the runtime binary and script path.
 * @param io - Optional stdout/stderr writers, working directory, and custom `fetch`.
 * @returns Process exit code (`0` on success, `1` on execution/drift failure, `2` on invalid usage).
 * @group cli
 */
export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliIo = DEFAULT_IO,
): Promise<number> {
  const { executeCli } = await import("./app.ts");
  return executeCli(argv, io);
}
