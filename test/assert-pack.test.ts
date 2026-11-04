import { expect, test } from "bun:test";

test.each(["main", "module", "typings", "unpkg", "jsdelivr"])(
  "pack assertion requires the %s entry",
  async (field) => {
    const directory = `${import.meta.dirname}/.assert-pack-${crypto.randomUUID()}`;
    try {
      await Bun.write(
        `${directory}/package.json`,
        JSON.stringify({
          name: "defjs-pack-fixture",
          version: "1.0.0",
          files: ["entry.js"],
          [field]: "./entry.js",
        }),
      );
      await Bun.write(`${directory}/LICENSE`, "MIT");
      await Bun.write(`${directory}/README.md`, "fixture");
      const run = () =>
        Bun.spawnSync([
          Bun.argv[0] ?? "bun",
          `${import.meta.dirname}/assert-pack.ts`,
          directory,
        ]);
      const missing = run();
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr.toString()).toContain(
        "missing from npm pack --dry-run: entry.js",
      );
      await Bun.write(`${directory}/entry.js`, "export {}");
      const complete = run();
      expect(complete.exitCode).toBe(0);
      expect(complete.stdout.toString()).toContain("assert-pack: ok");
    } finally {
      Bun.spawnSync(["rm", "-rf", directory]);
    }
  },
  30_000,
);
