import { expect, inject, test } from "vitest";
import { createFixtureClient } from "../fixture/client.ts";

export function registerBrowserControlSuite(): void {
  test("cross-origin PUT, GET, POST and DELETE with token and JSON succeed", async () => {
    const host = inject("testServerHost");
    const client = createFixtureClient(host, inject("fixtureToken"));
    try {
      await client.endpoint("slow", "hang", {});
      expect((await client.log()).requests).toEqual([]);
      // The endpoint exists and nothing is connected, so end is a conflict.
      // delete() removes the id and would answer 404 instead.
      await expect(client.act("slow", "end")).rejects.toThrow(/-> 409$/);
      const denied = await fetch(`${host}/__fixture/${client.id}/log`);
      expect(denied.status).toBe(403);
      await client.delete();
    } finally {
      await client.delete();
    }
  });

  test("eight held requests are released by delete() and the host answers again", async () => {
    const host = inject("testServerHost");
    // Each host has its own connection pool. Held requests fill 127.0.0.1,
    // so log and delete go through localhost.
    const client = createFixtureClient(
      host.replace("127.0.0.1", "localhost"),
      inject("fixtureToken"),
    );
    try {
      const held = await client.endpoint("held", "script", {
        plan: [{ status: 200, chunks: ["x"], then: "hold" }],
      });
      await client.endpoint("ok", "respond", { status: 200, body: "ok" });
      const base = held.replace("localhost", "127.0.0.1");
      // One URL per request: Firefox locks concurrent GETs of the same URL
      // on the HTTP cache entry. text() stays pending until the held body
      // closes; fetch() itself resolves when the headers arrive.
      const bodies = Array.from({ length: 8 }, (_, i) =>
        fetch(`${base}/${i}`)
          .then((r) => r.text())
          .then(
            () => "settled",
            () => "settled",
          ),
      );
      const logged = await client.log({ wait: 6 });
      expect(logged.requests.length).toBeGreaterThanOrEqual(6);
      for (const body of bodies) {
        expect(await Promise.race([body, Promise.resolve("pending")])).toBe(
          "pending",
        );
      }
      await client.delete();
      expect(await Promise.all(bodies)).toEqual([
        "settled",
        "settled",
        "settled",
        "settled",
        "settled",
        "settled",
        "settled",
        "settled",
      ]);
      const ok = await client.endpoint("ok", "respond", {
        status: 200,
        body: "ok",
      });
      expect((await fetch(ok.replace("localhost", "127.0.0.1"))).status).toBe(
        200,
      );
    } finally {
      await client.delete();
    }
  });
}
