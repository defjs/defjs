import { expect, test } from "vitest";
import { checkLinks } from "./check-links";
import { joinPath } from "./paths";
import { removeDirectory, tempDirectory } from "./tmp";
test("static link validation handles encoded paths/resources and rejects missing pages, anchors and empty output", async () => {
  const directory = tempDirectory("defjs-links");
  try {
    await expect(checkLinks(directory)).rejects.toThrow("No generated");
    await Bun.write(
      joinPath(directory, "index.html"),
      '<a href="/%E4%B8%AD%E6%96%87#target">中文</a><img src="/logo.jpg">',
    );
    await Bun.write(
      joinPath(directory, "中文/index.html"),
      '<h1 id="target">title</h1>',
    );
    await Bun.write(joinPath(directory, "logo.jpg"), "asset");
    await expect(checkLinks(directory)).resolves.toBeUndefined();
    await Bun.write(
      joinPath(directory, "index.html"),
      '<a href="/missing">missing</a><a href="/中文#missing">missing anchor</a>',
    );
    await expect(checkLinks(directory)).rejects.toThrow("missing page");
    await expect(checkLinks(directory)).rejects.toThrow("missing anchor");
  } finally {
    removeDirectory(directory);
  }
});

test("a directory without index.html is not a page, with or without an anchor", async () => {
  const directory = tempDirectory("defjs-links-dir");
  try {
    await Bun.write(
      joinPath(directory, "index.html"),
      '<a href="/api/core">core</a><a href="/api/core#anything">anchor</a>',
    );
    await Bun.write(
      joinPath(directory, "api/core/createclient/index.html"),
      '<h1 id="anything">title</h1>',
    );
    const error = await checkLinks(directory).then(
      () => {
        throw new Error("expected broken links");
      },
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    const lines = error instanceof Error ? error.message.split("\n") : [];
    expect(lines).toContain("/: missing page /api/core");
    expect(lines).toContain("/: missing page /api/core#anything");
  } finally {
    removeDirectory(directory);
  }
});

test("links to other origins and non-HTTP schemes are not checked", async () => {
  const directory = tempDirectory("defjs-links-external");
  try {
    await Bun.write(
      joinPath(directory, "index.html"),
      '<a href="https://example.com/missing">external</a><a href="mailto:team@example.com">mail</a>',
    );
    await expect(checkLinks(directory)).resolves.toBeUndefined();
  } finally {
    removeDirectory(directory);
  }
});

test("the SPA fallback shell is not a documentation page", async () => {
  const directory = tempDirectory("defjs-links-fallback");
  try {
    await Bun.write(joinPath(directory, "index.html"), "<h1>Home</h1>");
    await Bun.write(
      joinPath(directory, "__spa-fallback.html"),
      '<a href="/missing">broken</a>',
    );
    await expect(checkLinks(directory)).resolves.toBeUndefined();
  } finally {
    removeDirectory(directory);
  }
});
