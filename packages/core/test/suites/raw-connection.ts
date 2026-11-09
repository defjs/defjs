import { afterEach, beforeAll, expect, test } from "vitest";
import { createRawHandler } from "../fixture/raw-scenarios.ts";
import { createFixtureRegistry } from "../fixture/state.ts";
import {
  selectStartup,
  type StartedServer,
  type StartupLayer,
} from "../fixture/startup.ts";
import type { RawConnection, RawHandler } from "../fixture/types.ts";

const heldBody = new TextEncoder().encode(
  "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n3\r\nabc\r\n",
);

function bodyReader(
  response: Response,
): ReadableStreamDefaultReader<Uint8Array> {
  const body = response.body;
  if (body === null) throw new Error("response has no body");
  return body.getReader();
}

async function chunkText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const next = await reader.read();
  if (next.done || next.value === undefined) {
    throw new Error("expected a body chunk");
  }
  return new TextDecoder().decode(next.value);
}

export function registerRawConnectionSuite(): void {
  let startup: StartupLayer | undefined;
  const servers: StartedServer[] = [];

  beforeAll(async () => {
    startup = await selectStartup();
  });

  afterEach(async () => {
    const pending = servers.splice(0);
    for (const server of pending) await server.close();
  });

  async function start(handler: RawHandler): Promise<StartedServer> {
    if (startup === undefined) throw new Error("startup layer is not ready");
    const server = await startup.startRaw(handler);
    servers.push(server);
    return server;
  }

  function hold(): { handler: RawHandler; connection: () => RawConnection } {
    let stored: RawConnection | undefined;
    return {
      handler(head) {
        stored = head.connection;
        return { bytes: heldBody, then: "hold" };
      },
      connection() {
        if (stored === undefined) throw new Error("missing raw connection");
        return stored;
      },
    };
  }

  test("end() after a terminator chunk finishes the body", async () => {
    const held = hold();
    const server = await start(held.handler);
    const response = await fetch(server.origin);
    const reader = bodyReader(response);
    expect(await chunkText(reader)).toBe("abc");
    const connection = held.connection();
    connection.write(new TextEncoder().encode("0\r\n\r\n"));
    await connection.end();
    const next = await reader.read();
    expect(next.done).toBe(true);
  });

  test("end() without a terminator truncates the body", async () => {
    const held = hold();
    const server = await start(held.handler);
    const response = await fetch(server.origin);
    const reader = bodyReader(response);
    expect(await chunkText(reader)).toBe("abc");
    await held.connection().end();
    await expect(reader.read()).rejects.toThrow();
  });

  test("terminate() resets the connection", async () => {
    const held = hold();
    const server = await start(held.handler);
    const response = await fetch(server.origin);
    const reader = bodyReader(response);
    expect(await chunkText(reader)).toBe("abc");
    await held.connection().terminate();
    await expect(reader.read()).rejects.toThrow();
  });

  test("server.close() resolves while a connection is held", async () => {
    const held = hold();
    const server = await start(held.handler);
    const response = await fetch(server.origin);
    const reader = bodyReader(response);
    expect(await chunkText(reader)).toBe("abc");
    held.connection();
    await server.close();
    await expect(reader.read()).rejects.toThrow();
  });

  test("truncated reaches the client as an incomplete body", async () => {
    const registry = createFixtureRegistry();
    registry.create("f1");
    const server = await start(createRawHandler(registry));
    const response = await fetch(
      `${server.origin}/__fixture/f1/raw/truncated/503`,
    );
    expect(response.status).toBe(503);
    await expect(response.text()).rejects.toThrow();
  });

  test("reset-before-headers fails before any response", async () => {
    const registry = createFixtureRegistry();
    registry.create("f1");
    const server = await start(createRawHandler(registry));
    await expect(
      fetch(`${server.origin}/__fixture/f1/raw/reset-before-headers`),
    ).rejects.toThrow();
  });

  test("a held scenario can be terminated through its tracked connection", async () => {
    const registry = createFixtureRegistry();
    registry.create("f1");
    const server = await start(createRawHandler(registry));
    const response = await fetch(
      `${server.origin}/__fixture/f1/raw/partial-frame-resume/events`,
    );
    const reader = bodyReader(response);
    expect(await chunkText(reader)).toBe("id: 1\ndata: first\n\nid: 2\n");
    expect(
      await registry
        .get("f1")
        ?.live("raw:partial-frame-resume")
        ?.apply("terminate"),
    ).toBe(true);
    await expect(reader.read()).rejects.toThrow();
  });
}
