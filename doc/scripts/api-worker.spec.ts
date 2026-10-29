import { expect, test } from "vitest";
import { defined } from "./api-model";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectProcess,
  defaultRun,
  errorMessage,
  isRealNode,
  nodeBinary,
  nodeCandidates,
  parseWorkerJson,
  requestTypeTables,
  selectNodeBinary,
  workerFailure,
} from "./api-worker";

const doc = {
  file: "client.ts",
  name: "Client",
  entries: [
    {
      name: "id",
      description: "Id.",
      type: "string",
      simplifiedType: "string",
      required: true,
      deprecated: false,
      tags: [{ name: "see", text: "Client" }],
      typeHref: "#id",
    },
    { required: false, tags: [] },
    { name: "empty", tags: [{ name: "x" }], typeHref: "" },
  ],
};

test("the worker uses real Node, not Bun's node shim", () => {
  expect(nodeCandidates(" /bin/node \n\n /tmp/bun-node/node \n")).toEqual([
    "/bin/node",
    "/tmp/bun-node/node",
  ]);
  expect(
    selectNodeBinary(["/shim", "/real"], (binary) => binary === "/real"),
  ).toBe("/real");
  expect(() => selectNodeBinary(["/shim"], () => false)).toThrow(
    "node binary not found on PATH",
  );
  const directory = mkdtempSync(join(tmpdir(), "node-probe-"));
  const fake = join(directory, "node");
  writeFileSync(fake, "#!/bin/sh\necho object\n");
  chmodSync(fake, 0o755);
  expect(isRealNode(fake)).toBe(false);
  expect(isRealNode(join(directory, "missing"))).toBe(false);
  expect(isRealNode(nodeBinary())).toBe(true);
  expect(nodeBinary()).toBe(nodeBinary());
});

test("worker failures and JSON keep the last object", () => {
  expect(workerFailure(null, "", "")).toBe(
    "fumadocs-typescript worker exited null: no output",
  );
  expect(workerFailure(2, " bad ", "out")).toContain("bad");
  expect(workerFailure(2, " ", "out")).toContain("out");
  expect(errorMessage(new Error("boom"))).toBe("boom");
  expect(errorMessage("boom")).toBe("boom");
  expect(
    parseWorkerJson(
      `noise\n{bad\n${JSON.stringify({ docs: [doc, { entries: [] }] })}`,
    ).docs,
  ).toHaveLength(2);
  const entries = defined(
    defined(parseWorkerJson(JSON.stringify({ docs: [doc] })).docs[0], "doc")
      .entries,
    "entries",
  );
  expect(defined(entries[0], "entry").typeHref).toBe("#id");
  expect(defined(entries[1], "blank").name).toBe("");
  expect(() => parseWorkerJson("")).toThrow("invalid JSON: no output");
  expect(() => parseWorkerJson("{")).toThrow("invalid JSON");
  expect(() => parseWorkerJson("[]")).toThrow("invalid JSON: no output");
  expect(() => parseWorkerJson(JSON.stringify([]))).toThrow("no output");
  expect(() => parseWorkerJson(JSON.stringify({ docs: {} }))).toThrow(
    "expected docs array",
  );
  expect(() => parseWorkerJson(JSON.stringify({ docs: ["nope"] }))).toThrow(
    "expected doc object",
  );
  expect(() => parseWorkerJson(JSON.stringify({ docs: [null] }))).toThrow(
    "expected doc object",
  );
  expect(() => parseWorkerJson(JSON.stringify({ docs: [[]] }))).toThrow(
    "expected doc object",
  );
  expect(() => parseWorkerJson(JSON.stringify({ docs: [{}] }))).toThrow(
    "expected doc entries",
  );
  expect(() =>
    parseWorkerJson(JSON.stringify({ docs: [{ entries: [{}] }] })),
  ).toThrow("expected entry tags");
  expect(() =>
    parseWorkerJson(JSON.stringify({ docs: [{ entries: [{ tags: ["x"] }] }] })),
  ).toThrow("expected tag object");
});

test("the node worker reports a bad exit, invalid JSON, and a live process", async () => {
  await expect(
    requestTypeTables("script", {}, "/tmp", async () => ({
      code: 2,
      stdout: "",
      stderr: "bad",
    })),
  ).rejects.toThrow("exited 2: bad");
  await expect(
    requestTypeTables("script", {}, "/tmp", async () => ({
      code: 0,
      stdout: "nope",
      stderr: "",
    })),
  ).rejects.toThrow("invalid JSON");
  const echoed = await collectProcess(
    "node",
    ["-e", "process.stdin.pipe(process.stdout)"],
    '{"ok":true}\n',
    import.meta.dirname,
  );
  expect(echoed.code).toBe(0);
  expect(echoed.stdout).toContain("ok");
  const failed = await collectProcess(
    "node",
    ["-e", "process.stderr.write('bad'); process.exit(2)"],
    "",
    import.meta.dirname,
  );
  expect(failed.code).toBe(2);
  expect(failed.stderr).toContain("bad");
  const missing = await collectProcess(
    "definitely-missing-bin",
    [],
    "",
    import.meta.dirname,
  );
  expect(missing.code).toBeNull();
  expect(missing.stderr.length).toBeGreaterThan(0);
  const ran = await defaultRun(
    "process.stdout.write(JSON.stringify({ docs: [] }))",
    "",
    import.meta.dirname,
  );
  expect(ran.code).toBe(0);
  await expect(
    requestTypeTables(
      "process.stdout.write(JSON.stringify({ docs: [] }))",
      {},
      import.meta.dirname,
    ),
  ).resolves.toEqual({
    docs: [],
  });
});
