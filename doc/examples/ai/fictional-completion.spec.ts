import { expect, test } from "vitest";

type BunApi = {
  spawn(
    cmd: string[],
    options: {
      stdout: "pipe";
      stderr: "pipe";
    },
  ): {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
  };
};

declare const Bun: BunApi;
const bun = Bun;

async function runExample(omitCompletion = false) {
  const example = new URL("./fictional-completion.ts", import.meta.url).href;
  const program = `
    const NativeResponse = globalThis.Response;
    if (${omitCompletion}) {
      globalThis.Response = class extends NativeResponse {
        constructor(body, init) {
          const marker = typeof body === "string" ? body.indexOf("event: done") : -1;
          super(marker >= 0 ? body.slice(0, marker) : body, init);
        }
      };
    }
    globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
    await import(${JSON.stringify(example)});
  `;
  const child = bun.spawn([process.execPath, "-e", program], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("the offline example consumes both deltas and the completion event", async () => {
  const result = await runExample();
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("Hello there");
  expect(result.stderr).toBe("");
}, 10_000);

test("the offline example reports a stream without completion", async () => {
  const result = await runExample(true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Stream ended before the completion event");
}, 10_000);
