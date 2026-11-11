import { joinPath } from "./paths";

export async function buildFingerprint(
  root = `${import.meta.dirname}/../`,
): Promise<string> {
  const paths = (
    await Array.fromAsync(
      new Bun.Glob("{app,content,examples,public}/**/*").scan({
        cwd: root,
        onlyFiles: true,
      }),
    )
  ).filter((path) => !/\.spec\.tsx?$/.test(path));
  paths.push(
    "tsconfig.json",
    "vite.config.ts",
    "source.config.ts",
    "react-router.config.ts",
    "package.json",
    "scripts/build.ts",
    "scripts/build-state.ts",
    "scripts/check-links.ts",
    "../bun.lock",
    "../package.json",
  );
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of paths.sort()) {
    hash.update(path);
    hash.update(await Bun.file(joinPath(root, path)).arrayBuffer());
  }
  return hash.digest("hex");
}
