import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("the site origin comes from SITE_URL", async () => {
  vi.stubEnv("SITE_URL", "https://docs.example.test");
  const { siteUrl } = await import("./site");
  expect(siteUrl).toBe("https://docs.example.test");
});

test("local builds default to localhost", async () => {
  vi.stubEnv("SITE_URL", undefined);
  const { siteUrl } = await import("./site");
  expect(siteUrl).toBe("http://localhost:3000");
});
