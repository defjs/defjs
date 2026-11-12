import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { expect, onTestFinished, test } from "vitest";
import { envWithoutVitest, run } from "./spawn.ts";

const hook = `${import.meta.dirname}/../.githooks/pre-commit`;
const oxlintBin = realpathSync(
  `${import.meta.dirname}/../node_modules/.bin/oxlint`,
);

const pwn = `import { writeFileSync } from "node:fs";
const marker = process.env["PWN_MARKER"];
if (typeof marker === "string") writeFileSync(marker, "pwned\\n");
export default {};
`;

function hookEnv(dir: string): Record<string, string> {
  const env = envWithoutVitest();
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["PWN_MARKER"] = `${dir}/pwned`;
  return env;
}

async function scratch(): Promise<{
  dir: string;
  env: Record<string, string>;
}> {
  const dir = `${Bun.env["TMPDIR"] ?? "/tmp"}/defjs-pre-commit-${crypto.randomUUID()}`;
  mkdirSync(`${dir}/doc`, { recursive: true });
  mkdirSync(`${dir}/node_modules/.bin`, { recursive: true });
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const env = hookEnv(dir);
  await Bun.write(`${dir}/bunfig.toml`, "[run]\nbun = true\n");
  await Bun.write(`${dir}/package.json`, '{"scripts":{"typecheck":"true"}}\n');
  await Bun.write(
    `${dir}/doc/package.json`,
    '{"scripts":{"typegen":"true"}}\n',
  );
  await Bun.write(
    `${dir}/.oxlintrc.json`,
    '{"categories":{"correctness":"off"},"rules":{"no-var":"error"}}\n',
  );
  await Bun.write(`${dir}/pwn.ts`, pwn);
  symlinkSync(oxlintBin, `${dir}/node_modules/.bin/oxlint`);
  const init = await run(["git", "init", "-q"], { cwd: dir, env });
  expect(init.code).toBe(0);
  return { dir, env };
}

test(
  "lints a fully staged file whose name is an oxlint flag",
  { timeout: 60_000 },
  async () => {
    const { dir, env } = await scratch();
    await Bun.write(`${dir}/--config=pwn.ts`, "export const ok = 1;\n");
    await Bun.write(`${dir}/fixme.ts`, "var x = 1;\n");
    const added = await run(
      ["git", "add", "--", "--config=pwn.ts", "fixme.ts", "pwn.ts"],
      {
        cwd: dir,
        env,
      },
    );
    expect(added.code).toBe(0);

    const result = await run(["sh", hook], { cwd: dir, env });
    expect(result.code).toBe(0);
    expect(existsSync(`${dir}/pwned`)).toBe(false);
    const indexed = await run(["git", "show", ":fixme.ts"], { cwd: dir, env });
    expect(indexed.stdout).toBe("const x = 1;\n");
  },
);

test(
  "still lints when an unstaged name starts with a dash",
  { timeout: 60_000 },
  async () => {
    const { dir, env } = await scratch();
    await Bun.write(`${dir}/--config=pwn.ts`, "export const ok = 1;\n");
    await Bun.write(`${dir}/fixme.ts`, "var x = 1;\n");
    await Bun.write(`${dir}/partial.ts`, "var y = 1;\n");
    const added = await run(
      [
        "git",
        "add",
        "--",
        "--config=pwn.ts",
        "fixme.ts",
        "partial.ts",
        "pwn.ts",
      ],
      { cwd: dir, env },
    );
    expect(added.code).toBe(0);
    await Bun.write(`${dir}/--config=pwn.ts`, "export const ok = 2;\n");
    await Bun.write(`${dir}/partial.ts`, "var y = 2;\n");

    const result = await run(["sh", hook], { cwd: dir, env });
    expect(existsSync(`${dir}/pwned`)).toBe(false);
    // xargs reports a failed oxlint as 1 on BSD and 123 on GNU.
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("no-var");
    const indexed = await run(["git", "show", ":fixme.ts"], { cwd: dir, env });
    expect(indexed.stdout).toBe("const x = 1;\n");
    expect(readFileSync(`${dir}/partial.ts`, "utf8")).toBe("var y = 2;\n");
    const partial = await run(["git", "show", ":partial.ts"], {
      cwd: dir,
      env,
    });
    expect(partial.stdout).toBe("var y = 1;\n");
  },
);
