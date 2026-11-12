import { docRoot, joinPath, repoRoot } from "./paths";

/** The skill's reference directory. Every file in it is generated; `SKILL.md` beside it is the only hand-written one. */
export const referencesDirectory = joinPath(
  repoRoot,
  "skills/defjs/references",
);

/** En-US pages the skill ships, as slugs under `llms.mdx/`. A reference is named after the last segment of its slug. */
export const skillPages = [
  "docs/client",
  "docs/design-decisions",
  "docs/errors",
  "docs/http",
  "docs/integrations/opentelemetry-server",
  "docs/integrations/react",
  "docs/integrations/vue",
  "docs/interceptors",
  "docs/load-balancing",
  "docs/sse",
  "docs/struct",
  "docs/testing",
  "docs/web-socket",
  "recipes/publish-http-sdk",
] as const;

/** The processed Markdown that the documentation build emits for each skill page, keyed by reference file name. */
export async function generatedReferences(
  buildDirectory: string,
): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      skillPages.map(async (page) => {
        const name = `${page.slice(page.lastIndexOf("/") + 1)}.md`;
        const file = Bun.file(
          joinPath(buildDirectory, "llms.mdx", page, "content.md"),
        );
        return [name, await file.text()] as const;
      }),
    ),
  );
}

async function drift(
  wanted: ReadonlyMap<string, string>,
  directory: string,
): Promise<{ changed: Map<string, string>; extra: string[] }> {
  const changed = new Map<string, string>();
  for (const [name, text] of wanted) {
    const file = Bun.file(joinPath(directory, name));
    if (!(await file.exists()) || (await file.text()) !== text)
      changed.set(name, text);
  }
  const existing = await Array.fromAsync(
    new Bun.Glob("*.md").scan({ cwd: directory }),
  );
  return { changed, extra: existing.filter((name) => !wanted.has(name)) };
}

/** Fails when the committed references differ from the build output. */
export async function checkSkillReferences(
  buildDirectory: string,
  directory: string,
): Promise<void> {
  const { changed, extra } = await drift(
    await generatedReferences(buildDirectory),
    directory,
  );
  if (changed.size || extra.length)
    throw new Error(
      `skills/defjs/references differ from the documentation build (differing or missing: ${[...changed.keys()].join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"}); run "bun run --cwd doc sync-skill" and commit the result`,
    );
}

/** Copies the build output into the references directory and removes files that no skill page produces. */
export async function writeSkillReferences(
  buildDirectory: string,
  directory: string,
): Promise<void> {
  const { changed, extra } = await drift(
    await generatedReferences(buildDirectory),
    directory,
  );
  await Promise.all([
    ...Array.from(changed, ([name, text]) =>
      Bun.write(joinPath(directory, name), text),
    ),
    ...extra.map((name) => Bun.file(joinPath(directory, name)).delete()),
  ]);
}
/* istanbul ignore next -- @preserve: command-line entry point */
if (import.meta.main) {
  const build = joinPath(docRoot, "build/client");
  if (Bun.argv.includes("--check"))
    await checkSkillReferences(build, referencesDirectory);
  else await writeSkillReferences(build, referencesDirectory);
}
