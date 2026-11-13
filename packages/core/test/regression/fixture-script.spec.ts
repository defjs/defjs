import { expect, test } from "vitest";
import type { FixtureState } from "../fixture/state.ts";
import type { Harness } from "./fixture-app-harness.ts";
import { createHarness } from "./fixture-app-harness.ts";

function put(
  harness: Harness,
  id: string,
  name: string,
  scenario: string,
  params: unknown,
): Promise<Response> {
  return harness.call(
    "PUT",
    `/__fixture/${id}/endpoints/${encodeURIComponent(name)}`,
    { json: { scenario, params } },
  );
}

function stateOf(harness: Harness, id: string): FixtureState {
  const state = harness.registry.get(id);
  if (state === undefined) throw new Error(`missing fixture ${id}`);
  return state;
}

function readAll(response: Response): Promise<string> {
  return response.text();
}

function readerOf(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  const body = response.body;
  if (body === null) throw new Error("missing body");
  return body.getReader();
}

function chunkText(value: Uint8Array | undefined, done: boolean): string {
  if (done || value === undefined) throw new Error("missing chunk");
  return new TextDecoder().decode(value);
}

test("request n uses plan[min(n, last)]; headers and chunks are delivered in order", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "s", "script", {
        plan: [
          { status: 503, chunks: ["a"], then: "end" },
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
            chunks: ["data: 1\n\n", "data: 2\n\n"],
            then: "end",
          },
        ],
      })
    ).status,
  ).toBe(200);

  const first = await harness.call("GET", "/__fixture/id1/e/s", {
    token: null,
  });
  expect(first.status).toBe(503);
  expect(await readAll(first)).toBe("a");

  const second = await harness.call("GET", "/__fixture/id1/e/s", {
    token: null,
  });
  expect(second.status).toBe(200);
  expect(second.headers.get("content-type")).toBe("text/event-stream");
  expect(await readAll(second)).toBe("data: 1\n\ndata: 2\n\n");

  const third = await harness.call("GET", "/__fixture/id1/e/s", {
    token: null,
  });
  expect(third.status).toBe(200);
  expect(await readAll(third)).toBe("data: 1\n\ndata: 2\n\n");
});

test("hold keeps the response open until end", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "s", "script", {
        plan: [{ status: 200, chunks: ["x"], then: "hold" }],
      })
    ).status,
  ).toBe(200);
  const state = stateOf(harness, "id1");
  const response = await harness.call("GET", "/__fixture/id1/e/s", {
    token: null,
  });
  const reader = readerOf(response);
  const opened = await reader.read();
  expect(chunkText(opened.value, opened.done)).toBe("x");
  const connection = state.live("s");
  if (connection === undefined) throw new Error("missing script connection");
  expect(await connection.apply("end")).toBe(true);
  expect((await reader.read()).done).toBe(true);
  expect(state.live("s")).toBeUndefined();
});

test("hold + drop, hold + terminate and then: drop error the body after the delivered chunk", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "held", "script", {
        plan: [{ status: 200, chunks: ["x"], then: "hold" }],
      })
    ).status,
  ).toBe(200);
  const state = stateOf(harness, "id1");

  const dropping = await harness.call("GET", "/__fixture/id1/e/held", {
    token: null,
  });
  const dropReader = readerOf(dropping);
  const droppedChunk = await dropReader.read();
  expect(chunkText(droppedChunk.value, droppedChunk.done)).toBe("x");
  const drop = state.live("held");
  if (drop === undefined) throw new Error("missing script connection");
  expect(await drop.apply("drop")).toBe(true);
  await expect(dropReader.read()).rejects.toThrow("fixture drop");

  const terminating = await harness.call("GET", "/__fixture/id1/e/held", {
    token: null,
  });
  const terminateReader = readerOf(terminating);
  const terminatedChunk = await terminateReader.read();
  expect(chunkText(terminatedChunk.value, terminatedChunk.done)).toBe("x");
  const terminate = state.live("held");
  if (terminate === undefined) throw new Error("missing script connection");
  expect(await terminate.apply("terminate")).toBe(true);
  await expect(terminateReader.read()).rejects.toThrow("fixture terminate");

  expect(
    (
      await put(harness, "id1", "cut", "script", {
        plan: [{ status: 200, chunks: ["p"], then: "drop" }],
      })
    ).status,
  ).toBe(200);
  const cut = await harness.call("GET", "/__fixture/id1/e/cut", {
    token: null,
  });
  const cutReader = readerOf(cut);
  const cutChunk = await cutReader.read();
  expect(chunkText(cutChunk.value, cutChunk.done)).toBe("p");
  await expect(cutReader.read()).rejects.toThrow("fixture drop");
});

test("chunks [] with hold withholds the headers until end", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "s", "script", {
        plan: [
          {
            status: 202,
            headers: { "x-step": "1" },
            chunks: [],
            then: "hold",
          },
        ],
      })
    ).status,
  ).toBe(200);
  const state = stateOf(harness, "id1");
  const pending = harness.call("GET", "/__fixture/id1/e/s", { token: null });
  await state.whenLogged(1);
  const raced = await Promise.race([pending, Promise.resolve("pending")]);
  expect(raced).toBe("pending");
  const connection = state.live("s");
  if (connection === undefined) throw new Error("missing script connection");
  expect(await connection.apply("drop")).toBe(false);
  expect(await connection.apply("end")).toBe(true);
  const response = await pending;
  expect(response.status).toBe(202);
  expect(response.headers.get("x-step")).toBe("1");
  expect(await response.text()).toBe("");
});

test("chunks [] with then terminate sends the headers and errors the body", async () => {
  const harness = createHarness();
  expect(
    (
      await put(harness, "id1", "s", "script", {
        plan: [{ status: 200, chunks: [], then: "terminate" }],
      })
    ).status,
  ).toBe(200);
  const response = await harness.call("GET", "/__fixture/id1/e/s", {
    token: null,
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("expected a body");
  await expect(reader.read()).rejects.toThrow("fixture terminate");
});

test.each([204, 205, 304])(
  "null-body status %s sends no stream and rejects a body or an interrupt",
  async (status) => {
    const harness = createHarness();
    expect(
      (
        await put(harness, "id1", "empty", "script", {
          plan: [{ status, chunks: [], then: "end" }],
        })
      ).status,
    ).toBe(200);
    const ended = await harness.call("GET", "/__fixture/id1/e/empty", {
      token: null,
    });
    expect(ended.status).toBe(status);
    expect(await ended.text()).toBe("");

    expect(
      (
        await put(harness, "id1", "later", "script", {
          plan: [
            {
              status,
              headers: { "x-step": "1" },
              chunks: [],
              then: "hold",
            },
          ],
        })
      ).status,
    ).toBe(200);
    const state = stateOf(harness, "id1");
    const pending = harness.call("GET", "/__fixture/id1/e/later", {
      token: null,
    });
    await state.whenLogged(2);
    const connection = state.live("later");
    if (connection === undefined) throw new Error("missing script connection");
    expect(await connection.apply("end")).toBe(true);
    const held = await pending;
    expect(held.status).toBe(status);
    expect(held.headers.get("x-step")).toBe("1");
    expect(await held.text()).toBe("");

    expect(
      (
        await put(harness, "id1", "chunks", "script", {
          plan: [{ status, chunks: ["x"], then: "end" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put(harness, "id1", "drop", "script", {
          plan: [{ status, chunks: [], then: "drop" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put(harness, "id1", "terminate", "script", {
          plan: [{ status, chunks: [], then: "terminate" }],
        })
      ).status,
    ).toBe(400);
  },
);

async function readHeldChunk(
  harness: Harness,
  name: string,
  signal?: AbortSignal,
): Promise<{
  state: FixtureState;
  reader: ReadableStreamDefaultReader<Uint8Array>;
}> {
  expect(
    (
      await put(harness, "id1", name, "script", {
        plan: [{ status: 200, chunks: ["x"], then: "hold" }],
      })
    ).status,
  ).toBe(200);
  const state = stateOf(harness, "id1");
  const response = await harness.call("GET", `/__fixture/id1/e/${name}`, {
    token: null,
    signal,
  });
  const reader = readerOf(response);
  const opened = await reader.read();
  expect(chunkText(opened.value, opened.done)).toBe("x");
  return { state, reader };
}

test("a parked read resolves done when end is applied", async () => {
  const harness = createHarness();
  const { state, reader } = await readHeldChunk(harness, "s");
  const next = reader.read();
  const connection = state.live("s");
  if (connection === undefined) throw new Error("missing script connection");
  expect(await connection.apply("end")).toBe(true);
  expect((await next).done).toBe(true);
  expect(state.live("s")).toBeUndefined();
});

test.each(["drop", "terminate"] as const)(
  "a parked read rejects with fixture %s",
  async (action) => {
    const harness = createHarness();
    const { state, reader } = await readHeldChunk(harness, "s");
    const next = reader.read();
    const connection = state.live("s");
    if (connection === undefined) throw new Error("missing script connection");
    expect(await connection.apply(action)).toBe(true);
    await expect(next).rejects.toThrow(`fixture ${action}`);
  },
);

test("a parked read resolves done when the fixture is released", async () => {
  const harness = createHarness();
  const { reader } = await readHeldChunk(harness, "s");
  const next = reader.read();
  await harness.registry.delete("id1");
  expect((await next).done).toBe(true);
});

test("a parked read rejects with AbortError when the request aborts", async () => {
  const harness = createHarness();
  const controller = new AbortController();
  const { state, reader } = await readHeldChunk(
    harness,
    "s",
    controller.signal,
  );
  const next = reader.read();
  controller.abort();
  const error: unknown = await next.then(
    () => {
      throw new Error("parked read resolved");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DOMException);
  if (!(error instanceof DOMException)) {
    throw new Error("expected an AbortError");
  }
  expect(error.name).toBe("AbortError");
  expect(state.live("s")).toBeUndefined();
});
