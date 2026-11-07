import { expect, test } from "vitest";
import { API } from "typescript/async";
import { tableEntries } from "./type-tables";
import { removeDirectory, tempDirectory } from "./tmp";

const source = `export type Alias<T> = { value: T };
export interface Fixture {
  /** A string. */
  text: string;
  /** Optional text. */
  maybe?: string;
  /** Optional undefined. */
  nothing?: undefined;
  /** Union. */
  choice: "a" | "b";
  /** Intersection. */
  both: { a: 1 } & { b: 2 };
  /** Array. */
  items: string[];
  /** Tuple. */
  tuple: [string, number];
  /** Function. */
  callback: () => void;
  /** Named alias. */
  aliased: Alias<string>;
  /** Any value. */
  anything: any;
  /** Never. */
  impossible: never;
  /** @fumadocsType \`Custom\` */
  overridden: string;
  /** @remarks \`Simple\` */
  remarked: { a: 1 };
  /** @fumadocsHref https://example.com */
  linked: string;
  /** @fumadocsType not-in-backticks */
  untouchedType: string;
  /** @remarks not-in-backticks */
  untouchedRemarks: string;
  /** @fumadocsHref   */
  untouchedHref: string;
  /** @deprecated */
  old: string;
  /** @internal */
  hidden: string;
}
export interface Callable<T extends () => void> {
  handler: T;
}
export class Klass {
  visible = 1;
  #secret = 2;
}
export { Fixture as Renamed };
`;

async function fixtureProgram(): Promise<{
  api: API;
  file: string;
  directory: string;
  program: Awaited<ReturnType<API["createProgram"]>>;
}> {
  const directory = tempDirectory("defjs-type-tables");
  const file = `${directory}/packages/core/fixture.ts`;
  await Bun.write(file, source);
  const api = new API();
  const program = await api.createProgram([file], {
    lib: ["ESNext", "DOM", "DOM.Iterable"],
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: 9,
    types: [],
  });
  return { api, directory, file, program };
}

test("type tables cover aliases, unions, tuples, arrays, functions, and tags", async () => {
  const { api, directory, file, program } = await fixtureProgram();
  try {
    const checker = program.getProject().checker;
    const entries = await tableEntries(file, "Fixture", program, checker);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    expect([...byName.keys()]).toEqual([
      "text",
      "maybe",
      "nothing",
      "choice",
      "both",
      "items",
      "tuple",
      "callback",
      "aliased",
      "anything",
      "impossible",
      "overridden",
      "remarked",
      "linked",
      "untouchedType",
      "untouchedRemarks",
      "untouchedHref",
      "old",
    ]);
    expect(byName.get("text")?.simplifiedType).toBe("string");
    expect(byName.get("maybe")?.simplifiedType).toBe("string");
    expect(byName.get("nothing")?.simplifiedType).toBe("");
    expect(byName.get("choice")?.simplifiedType).toBe("union");
    expect(byName.get("both")?.simplifiedType).toBe("object");
    expect(byName.get("items")?.simplifiedType).toBe("array");
    expect(byName.get("tuple")?.simplifiedType).toBe("tuple");
    expect(byName.get("callback")?.simplifiedType).toBe("function");
    expect(byName.get("aliased")?.simplifiedType).toBe("Alias<string>");
    expect(byName.get("impossible")?.simplifiedType).toBe("never");
    expect(byName.get("overridden")?.type).toBe("Custom");
    expect(byName.get("remarked")?.simplifiedType).toBe("Simple");
    expect(byName.get("linked")?.typeHref).toBe("https://example.com");
    expect(byName.get("untouchedType")?.type).toBe("string");
    expect(byName.get("untouchedRemarks")?.simplifiedType).toBe("string");
    expect(byName.get("untouchedHref")?.typeHref).toBeUndefined();
    expect(byName.get("old")?.deprecated).toBe(true);
    expect(byName.has("hidden")).toBe(false);
  } finally {
    await api.close();
    removeDirectory(directory);
  }
});

test("class tables skip private members and alias exports resolve", async () => {
  const { api, directory, file, program } = await fixtureProgram();
  try {
    const checker = program.getProject().checker;
    const entries = await tableEntries(file, "Klass", program, checker);
    expect(entries.map((entry) => entry.name)).toEqual(["visible"]);
    const renamed = await tableEntries(file, "Renamed", program, checker);
    expect(renamed.map((entry) => entry.name)).toContain("text");
    const callable = await tableEntries(file, "Callable", program, checker);
    expect(callable[0]?.simplifiedType).toBe("function");
    await expect(
      tableEntries(file, "Missing", program, checker),
    ).rejects.toThrow("no export Missing");
  } finally {
    await api.close();
    removeDirectory(directory);
  }
});
