import { expect, test } from "bun:test";

const skillFile = new URL("../skills/defjs/SKILL.md", import.meta.url);

test("Defjs Skill has portable metadata and core guidance", async () => {
  const text = await Bun.file(skillFile).text();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match?.[1] || match[2] === undefined)
    throw new Error("SKILL.md is missing YAML frontmatter or instructions");
  const parsed = Bun.YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("SKILL.md frontmatter must be a YAML mapping");
  const metadata = parsed as Record<string, unknown>;
  const description = metadata["description"];
  expect(metadata["name"]).toBe("defjs");
  if (typeof description !== "string")
    throw new Error("SKILL.md description must be a string");
  expect(description.length).toBeGreaterThan(0);
  expect(description.length).toBeLessThanOrEqual(1024);
  expect(description.startsWith("Use when")).toBe(true);
  for (const name of [
    "@defjs/core",
    "@defjs/react",
    "@defjs/vue",
    "@defjs/opentelemetry-server",
  ])
    expect(description).toContain(name);
  const body = match[2];
  for (const name of [
    "defineRequest",
    "struct",
    "createClient",
    "withEndpoint",
  ])
    expect(body).toContain(name);
  expect(body).toContain("0.4.0");
  expect(body).toMatch(/synchronous pure/);
  expect(body).toMatch(/getUser\(client/);
  expect(body).toContain("client(options)");
  expect(body).toMatch(/error-first/);
  expect(body).toMatch(/no global client/i);
  expect(body).not.toContain("client.execute");
  expect(body).toContain(".parse()");
  expect(body).toMatch(/withSSEReconnect|reconnect stays off/);
  expect(body).toContain("POST");
});
