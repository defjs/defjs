import { expect, test } from "vitest";
import { buildFingerprint } from "./build-state";
import { finalizeBuild } from "./build";
import { joinPath } from "./paths";
import { removeDirectory, tempDirectory } from "./tmp";
test("static build finalization rejects changed inputs, supplies GitHub Pages 404.html and drops unused search .data copies", async () => {
  const directory = tempDirectory("defjs-finalize");
  try {
    await Bun.write(
      joinPath(directory, "404/index.html"),
      "<main><h1>404</h1></main>",
    );
    await Bun.write(joinPath(directory, "api/search/en-US.json"), "{}");
    await Bun.write(joinPath(directory, "api/search/en-US.json.data"), "[]");
    await expect(finalizeBuild(directory, "before", "after")).rejects.toThrow(
      "changed",
    );
    expect(
      await Bun.file(joinPath(directory, "build-stamp.txt")).exists(),
    ).toBe(false);
    await finalizeBuild(directory, "current", "current");
    expect(await Bun.file(joinPath(directory, "404.html")).text()).toContain(
      "<h1>404</h1>",
    );
    expect(
      await Bun.file(joinPath(directory, "api/search/en-US.json")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(
        joinPath(directory, "api/search/en-US.json.data"),
      ).exists(),
    ).toBe(false);
    expect(await Bun.file(joinPath(directory, "build-stamp.txt")).text()).toBe(
      "current",
    );
  } finally {
    removeDirectory(directory);
  }
});

test("build fingerprint covers included examples, public assets and tsconfig", async () => {
  const workspace = tempDirectory("defjs-fingerprint");
  const root = joinPath(workspace, "doc");
  try {
    await Bun.write(joinPath(workspace, "package.json"), "{}");
    await Bun.write(joinPath(workspace, "bun.lock"), "{}");
    for (const file of [
      "app/a.ts",
      "content/a.mdx",
      "examples/a.ts",
      "public/a.txt",
      "tsconfig.json",
      "vite.config.ts",
      "source.config.ts",
      "react-router.config.ts",
      "package.json",
      "scripts/build.ts",
      "scripts/build-state.ts",
      "scripts/check-links.ts",
    ])
      await Bun.write(joinPath(root, file), "one");
    await Bun.write(joinPath(root, "package.json"), "{}");
    let previous = await buildFingerprint(root);
    for (const file of [
      "examples/a.ts",
      "public/a.txt",
      "tsconfig.json",
      "source.config.ts",
    ]) {
      await Bun.write(joinPath(root, file), `changed ${file}`);
      const next = await buildFingerprint(root);
      expect(next).not.toBe(previous);
      previous = next;
    }
    // Colocated specs sit under app/ and examples/ but do not reach the site, so editing one must not stale the build.
    for (const file of ["app/a.spec.ts", "examples/a.spec.ts"])
      await Bun.write(joinPath(root, file), "spec");
    expect(await buildFingerprint(root)).toBe(previous);
  } finally {
    removeDirectory(workspace);
  }
});

test("build fingerprint changes when only a dependency version changes", async () => {
  const workspace = tempDirectory("defjs-fingerprint-deps");
  const root = joinPath(workspace, "doc");
  const versions = {
    uiCatalog: "16.17.1",
    uiResolved: "16.17.1",
    isbot: "5.2.2",
    docTypes: "19.2.3",
    otherTypes: "19.3.0",
    honoCatalog: "4.0.0",
    honoResolved: "4.0.0",
    transitive: "1.0.0",
  };
  const writeVersions = async (next: typeof versions) => {
    await Bun.write(
      joinPath(workspace, "package.json"),
      JSON.stringify({
        workspaces: {
          catalog: {
            "fumadocs-ui": next.uiCatalog,
            "@types/react-dom": "19.2.3",
            hono: next.honoCatalog,
          },
        },
      }),
    );
    await Bun.write(
      joinPath(workspace, "bun.lock"),
      JSON.stringify({
        workspaces: { doc: { name: "doc" } },
        packages: {
          "fumadocs-ui": [`fumadocs-ui@${next.uiResolved}`, ""],
          isbot: [`isbot@${next.isbot}`, ""],
          "@types/react-dom": [`@types/react-dom@${next.otherTypes}`, ""],
          "doc/@types/react-dom": [`@types/react-dom@${next.docTypes}`, ""],
          hono: [`hono@${next.honoResolved}`, ""],
          transitive: [`transitive@${next.transitive}`, ""],
        },
      }),
    );
  };
  try {
    for (const file of [
      "app/a.ts",
      "content/a.mdx",
      "examples/a.ts",
      "public/a.txt",
      "tsconfig.json",
      "vite.config.ts",
      "source.config.ts",
      "react-router.config.ts",
      "scripts/build.ts",
      "scripts/build-state.ts",
      "scripts/check-links.ts",
    ])
      await Bun.write(joinPath(root, file), "one");
    await Bun.write(
      joinPath(root, "package.json"),
      JSON.stringify({
        name: "doc",
        dependencies: { isbot: "^5" },
        devDependencies: {
          "fumadocs-ui": "catalog:",
          "@types/react-dom": "catalog:",
          "@defjs/core": "workspace:^",
        },
      }),
    );
    await writeVersions(versions);
    const current = await buildFingerprint(root);
    await writeVersions({ ...versions, uiCatalog: "16.17.2" });
    expect(await buildFingerprint(root)).not.toBe(current);
    await writeVersions({ ...versions, isbot: "5.2.3" });
    expect(await buildFingerprint(root)).not.toBe(current);
    await writeVersions({ ...versions, docTypes: "19.2.4" });
    expect(await buildFingerprint(root)).not.toBe(current);
    await writeVersions({ ...versions, transitive: "1.0.1" });
    expect(await buildFingerprint(root)).not.toBe(current);
  } finally {
    removeDirectory(workspace);
  }
});

test("the build fingerprint defaults to the documentation workspace", async () => {
  expect(await buildFingerprint()).toMatch(/^[0-9a-f]{64}$/);
});

test("static build finalization requires the generated 404 page", async () => {
  const directory = tempDirectory("defjs-finalize-404");
  try {
    await expect(
      finalizeBuild(directory, "current", "current"),
    ).rejects.toThrow("Missing generated 404 page");
  } finally {
    removeDirectory(directory);
  }
});

test("temporary directories fall back to /tmp without TMPDIR", () => {
  const saved = Bun.env["TMPDIR"];
  delete Bun.env["TMPDIR"];
  try {
    expect(tempDirectory("defjs-fallback")).toMatch(/^\/tmp\/defjs-fallback-/);
  } finally {
    if (saved !== undefined) Bun.env["TMPDIR"] = saved;
  }
});
