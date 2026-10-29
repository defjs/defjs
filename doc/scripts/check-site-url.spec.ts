import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const check = async (value: string | undefined) => {
  vi.stubEnv("SITE_URL", value);
  vi.resetModules();
  await import("./check-site-url");
};

test("a production HTTPS origin is accepted", async () => {
  await expect(check("https://docs.example.com")).resolves.toBeUndefined();
  await expect(check("https://docs.example.com/")).resolves.toBeUndefined();
});

test("a missing SITE_URL is rejected", async () => {
  await expect(check(undefined)).rejects.toThrow("SITE_URL must be set");
  await expect(check("")).rejects.toThrow("SITE_URL must be set");
});

test.each([
  ["a non-HTTPS origin", "http://docs.example.com"],
  ["localhost", "https://localhost"],
  ["a loopback address", "https://127.0.0.1"],
  ["an IPv6 loopback address", "https://[::1]"],
  ["a path", "https://docs.example.com/docs"],
  ["a query", "https://docs.example.com/?a=1"],
  ["a fragment", "https://docs.example.com/#top"],
  ["a username", "https://user@docs.example.com"],
  ["a password", "https://:secret@docs.example.com"],
])("%s is rejected", async (_name, value) => {
  await expect(check(value)).rejects.toThrow(
    "SITE_URL must be a production HTTPS origin",
  );
});
