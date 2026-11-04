import { expect, test } from "vitest";
import { joinPath } from "../../scripts/paths";
import { removeDirectory, tempDirectory } from "../../scripts/tmp";

type BunApi = {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  file(path: URL | string): { text(): Promise<string> };
  write(path: string, data: string): Promise<number>;
  spawn(
    cmd: string[],
    options: {
      stdout: "pipe";
      stderr: "pipe";
      env?: Record<string, string | undefined>;
    },
  ): {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
  };
};

declare const Bun: BunApi;
const bun = Bun;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`expected ${label}`);
  return value;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`expected ${key}`);
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`expected ${key}`);
  return value;
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number"))
    throw new Error("expected a number list");
  return value.filter((item): item is number => typeof item === "number");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error("expected a string list");
  return value.filter((item): item is string => typeof item === "string");
}

async function executeRecipe(
  name: string,
  observations: string,
): Promise<void> {
  const code = await bun.file(new URL(`./${name}.ts`, import.meta.url)).text();

  // Run the example file that the recipe page includes and observe the responses produced by its mock.
  const source = code
    .replace(
      /(["'])@defjs\/core\1/,
      JSON.stringify(
        new URL("../../../packages/core/src/index.ts", import.meta.url).href,
      ),
    )
    .replace(/\bwithHTTPHandle\b/, "withHTTPHandle as installHTTPHandle");
  const observed = `
const statuses: number[] = []
function withHTTPHandle(handle: Parameters<typeof installHTTPHandle>[0]) {
  return installHTTPHandle(async (input, init) => {
    const response = await handle(input, init)
    statuses.push(response.status)
    return response
  })
}
${source}
export { statuses }
${observations}
`;
  const directory = tempDirectory("defjs-recipe");
  const filename = joinPath(directory, "recipe.ts");
  await bun.write(filename, observed);
  const loaded: unknown = await import(filename).finally(() => {
    removeDirectory(directory);
  });
  if (!isRecord(loaded))
    throw new Error(`recipe ${name} did not export a module`);
  const statuses = numberList(loaded["statuses"]);
  if (name === "etag-revalidate") {
    expect(statuses).toEqual([200, 304]);
    expect(textField(recordField(loaded["product"], "product"), "name")).toBe(
      "Flask",
    );
  } else if (name === "graphql-http-envelope") {
    expect(textField(recordField(loaded["viewer"], "viewer"), "login")).toBe(
      "ada",
    );
    expect(statuses).toEqual([200, 200, 200, 200]);
    expect(stringList(loaded["graphQlErrors"])).toEqual([
      "viewer unavailable",
      "viewer unavailable",
    ]);
    const nullableError = recordField(loaded["nullableError"], "nullableError");
    expect(textField(nullableError, "message")).toBe("viewer unavailable");
    expect(nullableError["code"]).toBeUndefined();
  } else {
    expect(statuses).toEqual([401, 200]);
    expect(
      textField(recordField(loaded["credential"], "credential"), "accessToken"),
    ).toBe("v2");
    expect(loaded["error"]).toBeNull();
    expect(
      numberField(recordField(loaded["invoice"], "invoice"), "total"),
    ).toBe(42);
  }
}

test.each([
  { id: 7, exitCode: 0 },
  { id: 8, exitCode: 1 },
])(
  "local HTTP test exits $exitCode for order $id",
  async ({ id, exitCode }) => {
    const source = (
      await bun.file(new URL("./test-with-handle.ts", import.meta.url)).text()
    )
      .replace(
        '"@defjs/core"',
        JSON.stringify(
          new URL("../../../packages/core/src/index.ts", import.meta.url).href,
        ),
      )
      .replace(
        "getOrder(client, { id: 7 })",
        `getOrder(client, { id: ${id} })`,
      );
    const directory = tempDirectory("defjs-local-test");
    try {
      const filename = joinPath(directory, "get-order.test.ts");
      await bun.write(filename, source);
      const child = bun.spawn([Bun.argv[0] ?? "bun", filename], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...Bun.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      });
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(status).toBe(exitCode);
      if (exitCode === 0) {
        expect(stdout).toContain("paid 200");
        expect(stderr).toBe("");
      } else {
        expect(stdout).not.toContain("paid 200");
        expect(stderr).toContain("HTTP_STATUS");
      }
    } finally {
      removeDirectory(directory);
    }
  },
);

test("ETag recipe reuses the cached product after a real 304", async () => {
  await executeRecipe("etag-revalidate", "export { product }");
});

test("Bearer recipe refreshes the credential after a real 401", async () => {
  await executeRecipe(
    "refresh-bearer-once",
    "export { credential, error, invoice }",
  );
});

test("GraphQL recipe unwraps data: null with errors as an application error", async () => {
  await executeRecipe(
    "graphql-http-envelope",
    `const nullableError = await loadViewer(createClient(
      withEndpoint('https://api.example.test'),
      withHTTPHandle(async () => Response.json({ data: null, errors: [{ message: 'viewer unavailable' }] })),
    )).catch((error: unknown) => error)
    export { viewer, graphQlErrors, nullableError }`,
  );
});
