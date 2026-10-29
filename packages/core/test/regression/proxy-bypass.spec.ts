import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("test configuration bypasses loopback proxies while preserving external proxy settings", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.end(request.url === "/" ? "loopback" : "proxy");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a loopback port");
  const host = `http://127.0.0.1:${address.port}`;
  const sharedConfig = new URL("../shared.ts", import.meta.url).href;

  try {
    const { stdout } = await promisify(execFile)(
      "bun",
      [
        "--eval",
        `
          await import(${JSON.stringify(sharedConfig)})
          console.log(JSON.stringify({
            local: await (await fetch(${JSON.stringify(host)})).text(),
            external: await (await fetch('http://proxy-target.invalid/')).text(),
            upper: process.env.NO_PROXY,
            lower: process.env.no_proxy,
          }))
        `,
      ],
      {
        env: {
          ...process.env,
          HTTP_PROXY: host,
          HTTPS_PROXY: host,
          ALL_PROXY: host,
          http_proxy: host,
          https_proxy: host,
          all_proxy: host,
          NO_PROXY: "upper.example",
          no_proxy: "lower.example",
        },
        timeout: 5000,
      },
    );
    const result = JSON.parse(stdout);
    expect(result.local).toBe("loopback");
    expect(result.external).toBe("proxy");
    expect(requests).toEqual(["/", "http://proxy-target.invalid/"]);
    for (const value of [result.upper, result.lower]) {
      expect(value.split(",")).toEqual(
        expect.arrayContaining(["upper.example", "lower.example"]),
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
