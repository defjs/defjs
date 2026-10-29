import { join } from "node:path";
import { parseExampleFile } from "./api-tags";

export interface ExampleFile {
  path: string;
  region: string;
  code: string;
}

export function readExampleRegion(source: string, region: string): string {
  const marker = `// #region ${region}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing #region ${region}`);
  const after = source.indexOf("\n", start);
  if (after < 0) throw new Error(`missing #region ${region} body`);
  const end = source.indexOf("// #endregion", after);
  if (end < 0) throw new Error(`missing #endregion for ${region}`);
  return source.slice(after + 1, end).replace(/\s+$/, "");
}

export async function readText(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`missing example file: ${path}`);
  return file.text();
}

export async function loadExample(
  docRoot: string,
  spec: string,
  read: (path: string) => Promise<string> = readText,
): Promise<ExampleFile> {
  const parsed = parseExampleFile(spec);
  try {
    const source = await read(join(docRoot, parsed.path));
    return { ...parsed, code: readExampleRegion(source, parsed.region) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read @exampleFile ${spec}: ${message}`);
  }
}
