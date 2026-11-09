import { expect, inject, test } from "vitest";
import { fixture } from "../fixture/client-auto.ts";

function readerOf(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  const body = response.body;
  if (body === null) throw new Error("missing body");
  return body.getReader();
}

function chunkText(value: Uint8Array | undefined, done: boolean): string {
  if (done || value === undefined) throw new Error("missing chunk");
  return new TextDecoder().decode(value);
}

test.each(["end", "drop", "terminate"] as const)(
  "a held script chunk stays delivered and %s settles the unread body",
  async (action) => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    const base = await f.endpoint("partial", "script", {
      plan: [
        {
          status: 200,
          headers: { "content-type": "application/json" },
          chunks: ['{"partial":'],
          then: "hold",
        },
      ],
    });
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const reader = readerOf(response);
    const opened = await reader.read();
    expect(chunkText(opened.value, opened.done)).toBe('{"partial":');
    await f.act("partial", action);
    if (action === "end") {
      expect((await reader.read()).done).toBe(true);
      return;
    }
    await expect(reader.read()).rejects.toThrow();
  },
);

test("raw utf8-last-event-id keeps the UTF-8 id and obeys terminate", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const o = inject("rawServerOrigin");
  // A raw request does not create fixture state; the id has to exist first.
  await f.endpoint("anchor", "hang", {});
  const response = await fetch(
    f.rawUrl(o, "utf8-last-event-id", "events", "猫"),
  );
  const reader = readerOf(response);
  const opened = await reader.read();
  expect(chunkText(opened.value, opened.done)).toBe("id: 猫\ndata: first\n\n");
  await f.act("raw:utf8-last-event-id", "terminate");
  await expect(reader.read()).rejects.toThrow();
});

test("DELETE releases held responses and isolates ids", async () => {
  const f1 = fixture(inject("testServerHost"), inject("fixtureToken"));
  const f2 = fixture(inject("testServerHost"), inject("fixtureToken"));
  const held = await f1.endpoint("primary", "script", {
    plan: [{ status: 200, chunks: ["x"], then: "hold" }],
  });
  const other = await f2.endpoint("primary", "respond", {
    status: 200,
    body: "ok",
  });
  const response = await fetch(held);
  const reader = readerOf(response);
  const opened = await reader.read();
  expect(chunkText(opened.value, opened.done)).toBe("x");
  await f1.delete();
  expect(
    await reader.read().then(
      () => "settled",
      () => "settled",
    ),
  ).toBe("settled");
  expect((await fetch(held)).status).toBe(404);
  expect((await f2.log()).requests).toEqual([]);
  expect((await fetch(other)).status).toBe(200);
});
