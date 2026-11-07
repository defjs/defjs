import { expect, test } from "vitest";

test("test configuration bypasses loopback proxies while preserving external proxy settings", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      const host = request.headers.get("host") ?? url.host;
      requests.push(`${host}${url.pathname}`);
      return new Response(host.startsWith("127.0.0.1") ? "loopback" : "proxy");
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const host = `http://127.0.0.1:${server.port}`;
  const sharedConfig = new URL("../shared.ts", import.meta.url).href;

  try {
    const probe = Bun.spawn(
      [
        "bun",
        "--eval",
        `
          await import(${JSON.stringify(sharedConfig)})
          console.log(JSON.stringify({
            local: await (await fetch(${JSON.stringify(host)})).text(),
            external: await (await fetch('http://proxy-target.invalid/')).text(),
            upper: Bun.env.NO_PROXY,
            lower: Bun.env.no_proxy,
          }))
        `,
      ],
      {
        env: {
          ...Bun.env,
          HTTP_PROXY: host,
          HTTPS_PROXY: host,
          ALL_PROXY: host,
          http_proxy: host,
          https_proxy: host,
          all_proxy: host,
          NO_PROXY: "upper.example",
          no_proxy: "lower.example",
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const stdout = await new Response(probe.stdout).text();
    expect(await probe.exited).toBe(0);
    const parsed: unknown = JSON.parse(stdout);
    if (!isProbe(parsed)) {
      throw new Error("Expected the proxy probe to print an object");
    }
    const local = parsed["local"];
    const external = parsed["external"];
    const upper = parsed["upper"];
    const lower = parsed["lower"];
    if (
      typeof local !== "string" ||
      typeof external !== "string" ||
      typeof upper !== "string" ||
      typeof lower !== "string"
    ) {
      throw new Error("Expected the proxy probe fields to be strings");
    }
    expect(local).toBe("loopback");
    expect(external).toBe("proxy");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatch(/^127\.0\.0\.1:\d+\/$/);
    expect(requests[1]).toBe("proxy-target.invalid/");
    for (const value of [upper, lower]) {
      expect(value.split(",")).toEqual(
        expect.arrayContaining(["upper.example", "lower.example"]),
      );
    }
  } finally {
    await server.stop(true);
  }
});

function isProbe(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
