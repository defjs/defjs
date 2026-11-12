import { expect, test } from "vitest";
import { joinPath } from "./paths";
import {
  checkSkillReferences,
  generatedReferences,
  skillPages,
  writeSkillReferences,
} from "./sync-skill";
import { removeDirectory, tempDirectory } from "./tmp";

async function fakeBuild(build: string, marker: string): Promise<void> {
  for (const page of skillPages)
    await Bun.write(
      joinPath(build, "llms.mdx", page, "content.md"),
      `${marker} ${page}\n`,
    );
}

test("skill references are the build's processed Markdown, named after the page", async () => {
  const workspace = tempDirectory("defjs-skill-pages");
  try {
    await fakeBuild(workspace, "one");
    const references = await generatedReferences(workspace);
    expect(references.size).toBe(skillPages.length);
    expect(references.get("react.md")).toBe("one docs/integrations/react\n");
    expect(references.get("publish-http-sdk.md")).toBe(
      "one recipes/publish-http-sdk\n",
    );
  } finally {
    removeDirectory(workspace);
  }
});

test("writing copies changed pages, drops unexpected files and leaves current ones alone", async () => {
  const workspace = tempDirectory("defjs-skill-write");
  const build = joinPath(workspace, "build");
  const directory = joinPath(workspace, "references");
  try {
    await fakeBuild(build, "one");
    await Bun.write(joinPath(directory, "old-topic.md"), "hand written");
    await Bun.write(joinPath(directory, "notes.txt"), "not a reference");
    await writeSkillReferences(build, directory);
    await checkSkillReferences(build, directory);
    expect(await Bun.file(joinPath(directory, "old-topic.md")).exists()).toBe(
      false,
    );
    expect(await Bun.file(joinPath(directory, "notes.txt")).text()).toBe(
      "not a reference",
    );
    const sdk = Bun.file(joinPath(directory, "publish-http-sdk.md"));
    expect(await sdk.text()).toBe("one recipes/publish-http-sdk\n");
    await fakeBuild(build, "two");
    await writeSkillReferences(build, directory);
    expect(await sdk.text()).toBe("two recipes/publish-http-sdk\n");
  } finally {
    removeDirectory(workspace);
  }
});

test("checking names every differing, missing and unexpected reference and the command that fixes them", async () => {
  const workspace = tempDirectory("defjs-skill-check");
  const build = joinPath(workspace, "build");
  const directory = joinPath(workspace, "references");
  try {
    await fakeBuild(build, "one");
    await Bun.write(joinPath(directory, "notes.txt"), "not a reference");
    await writeSkillReferences(build, directory);
    await Bun.write(joinPath(directory, "react.md"), "edited by hand");
    await Bun.file(joinPath(directory, "vue.md")).delete();
    await Bun.write(joinPath(directory, "old-topic.md"), "hand written");
    await expect(checkSkillReferences(build, directory)).rejects.toThrow(
      /react\.md, vue\.md; unexpected: old-topic\.md\); run "bun run --cwd doc sync-skill"/,
    );
    await writeSkillReferences(build, directory);
    await Bun.write(joinPath(directory, "old-topic.md"), "hand written");
    await expect(checkSkillReferences(build, directory)).rejects.toThrow(
      "differing or missing: none; unexpected: old-topic.md",
    );
    await writeSkillReferences(build, directory);
    await Bun.write(joinPath(directory, "react.md"), "edited by hand");
    await expect(checkSkillReferences(build, directory)).rejects.toThrow(
      "differing or missing: react.md; unexpected: none",
    );
  } finally {
    removeDirectory(workspace);
  }
});
