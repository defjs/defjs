import { expect, test, vi } from "vitest";
import { createRawHandler, readRawHead } from "../fixture/raw-scenarios.ts";
import { createFixtureRegistry } from "../fixture/state.ts";
import type { RawReply, RawRequestHead } from "../fixture/types.ts";

const truncatedBody =
  "HTTP/1.1 200 Response\r\n" +
  "access-control-allow-origin: *\r\n" +
  "content-type: application/json\r\n" +
  "transfer-encoding: chunked\r\n" +
  "connection: close\r\n" +
  "\r\n" +
  "b\r\n" +
  '{"partial":\r\n';

const notFoundBody =
  "HTTP/1.1 404 Not Found\r\n" +
  "access-control-allow-origin: *\r\n" +
  "access-control-allow-methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS\r\n" +
  "access-control-allow-headers: *\r\n" +
  "content-length: 0\r\n" +
  "connection: close\r\n" +
  "\r\n";

function head(target: string, method = "GET"): RawRequestHead {
  const parsed = readRawHead(
    `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Probe: 1\r\n\r\n`,
  );
  if (parsed === undefined) {
    throw new Error("head did not parse");
  }
  return {
    ...parsed,
    connection: {
      write() {},
      end() {
        return Promise.resolve();
      },
      terminate() {
        return Promise.resolve();
      },
    },
  };
}

function text(reply: RawReply | undefined): string {
  if (reply === undefined) {
    throw new Error("expected a raw reply");
  }
  return new TextDecoder().decode(reply.bytes);
}

function expectNotFound(reply: RawReply | undefined): void {
  expect(text(reply)).toBe(notFoundBody);
  expect(reply?.then).toBe("end");
}

function connection() {
  const write = vi.fn((): void => undefined);
  const end = vi.fn((): Promise<void> => Promise.resolve());
  const terminate = vi.fn((): Promise<void> => Promise.resolve());
  const socket: RawRequestHead["connection"] = { write, end, terminate };
  return { socket, write, end, terminate };
}

function headWith(
  target: string,
  headers: Record<string, string>,
  socket: RawRequestHead["connection"],
): RawRequestHead {
  const lines = [`GET ${target} HTTP/1.1`, "Host: 127.0.0.1"];
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`${name}: ${value}`);
  }
  lines.push("", "");
  const parsed = readRawHead(lines.join("\r\n"));
  if (parsed === undefined) {
    throw new Error("head did not parse");
  }
  return { ...parsed, connection: socket };
}

function firstLine(reply: RawReply | undefined): string {
  const value = text(reply);
  const end = value.indexOf("\r\n");
  return end < 0 ? value : value.slice(0, end);
}

function open() {
  const registry = createFixtureRegistry();
  const f1 = registry.create("f1");
  return { registry, f1, handler: createRawHandler(registry) };
}

test("readRawHead waits for the blank line", () => {
  expect(readRawHead("GET / HTTP/1.1\r\nHost: a\r\n")).toBeUndefined();
  expect(readRawHead("BROKEN\r\n\r\n")).toBeUndefined();
});

test("readRawHead lowercases header names and keeps the raw head", () => {
  const received = "GET /x?y=1 HTTP/1.1\r\nHost: a\r\nX-Probe: 1\r\n\r\n";
  const parsed = readRawHead(received);

  expect(parsed?.method).toBe("GET");
  expect(parsed?.target).toBe("/x?y=1");
  expect(parsed?.headers).toEqual({ host: "a", "x-probe": "1" });
  expect(parsed?.rawHead.startsWith("GET /x?y=1 HTTP/1.1\r\n")).toBe(true);
  expect(parsed?.rawHead.endsWith("\r\n\r\n")).toBe(true);
});

test("truncated answers with an unterminated chunked body", () => {
  const { handler } = open();
  const reply = handler(head("/__fixture/f1/raw/truncated"));

  expect(text(reply)).toBe(truncatedBody);
  expect(reply?.then).toBe("end");
});

test("truncated takes its status from the first path segment", () => {
  const { handler } = open();

  expect(firstLine(handler(head("/__fixture/f1/raw/truncated/503")))).toBe(
    "HTTP/1.1 503 Response",
  );
  expectNotFound(handler(head("/__fixture/f1/raw/truncated/99")));
  expectNotFound(handler(head("/__fixture/f1/raw/truncated/abc")));
});

test("truncated logs a registered fixture only", () => {
  const { registry, f1, handler } = open();
  const first = head("/__fixture/f1/raw/truncated");
  handler(first);

  expect(f1.requests).toEqual([
    {
      endpoint: "raw:truncated",
      method: "GET",
      path: "/",
      headers: { host: "127.0.0.1", "x-probe": "1" },
      rawHead: first.rawHead,
    },
  ]);

  handler(head("/__fixture/f1/raw/truncated/503"));
  expect(f1.requests[1]?.path).toBe("/503");

  const missing = handler(head("/__fixture/missing/raw/truncated"));
  expect(firstLine(missing)).toBe("HTTP/1.1 200 Response");
  expect(f1.requests).toHaveLength(2);
  expect(registry.get("missing")).toBeUndefined();
});

test("OPTIONS is answered with CORS and not logged", () => {
  const { f1, handler } = open();
  const reply = handler(head("/__fixture/f1/raw/truncated", "OPTIONS"));
  const body = text(reply);

  expect(firstLine(reply)).toBe("HTTP/1.1 204 No Content");
  expect(body).toContain(
    "access-control-allow-methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  expect(body).toContain("access-control-allow-origin: *");
  expect(body).toContain("access-control-allow-headers: *");
  expect(body).toContain("connection: close");
  expect(reply?.then).toBe("end");
  expect(f1.requests).toEqual([]);
});

test("unknown scenarios and foreign paths answer 404", () => {
  const { f1, handler } = open();

  expectNotFound(handler(head("/__fixture/f1/raw/nope")));
  expectNotFound(handler(head("/other")));
  expect(f1.requests).toEqual([]);
});

test("utf8-last-event-id: first reply holds with the UTF-8 id; resume reply is terminated", () => {
  const { handler } = open();
  const first = handler(
    headWith(
      "/__fixture/f1/raw/utf8-last-event-id/events/%E7%8C%AB",
      {},
      connection().socket,
    ),
  );
  const body = text(first);

  expect(body).toContain("\r\n15\r\nid: 猫\ndata: first\n\n\r\n");
  expect(body).not.toContain("0\r\n\r\n");
  expect(first?.then).toBe("hold");

  const empty = handler(
    headWith("/__fixture/f1/raw/utf8-last-event-id", {}, connection().socket),
  );
  expect(text(empty)).toContain("\r\n12\r\nid: \ndata: first\n\n\r\n");
  expect(empty?.then).toBe("hold");

  const resume = handler(
    headWith(
      "/__fixture/f1/raw/utf8-last-event-id/events/%E7%8C%AB",
      { "Last-Event-ID": "猫" },
      connection().socket,
    ),
  );
  expect(text(resume)).toContain("\r\ne\r\ndata: second\n\n\r\n0\r\n\r\n");
  expect(resume?.then).toBe("end");
});

test("partial-frame-resume follows the committed cursor", () => {
  const { handler } = open();
  const first = handler(
    headWith(
      "/__fixture/f1/raw/partial-frame-resume/events",
      {},
      connection().socket,
    ),
  );

  expect(text(first)).toContain("\r\n19\r\nid: 1\ndata: first\n\nid: 2\n\r\n");
  expect(text(first)).not.toContain("0\r\n\r\n");
  expect(first?.then).toBe("hold");

  const resumed = handler(
    headWith(
      "/__fixture/f1/raw/partial-frame-resume/events",
      { "Last-Event-ID": "1" },
      connection().socket,
    ),
  );
  expect(text(resumed)).toContain(
    "\r\n14\r\nid: 2\ndata: second\n\n\r\n0\r\n\r\n",
  );
  expect(resumed?.then).toBe("end");

  const skipped = handler(
    headWith(
      "/__fixture/f1/raw/partial-frame-resume/events",
      { "Last-Event-ID": "0" },
      connection().socket,
    ),
  );
  expect(text(skipped)).toContain(
    "\r\n15\r\nid: 3\ndata: skipped\n\n\r\n0\r\n\r\n",
  );
  expect(skipped?.then).toBe("end");
});

test("reset-before-headers writes nothing and terminates", () => {
  const { f1, handler } = open();
  const request = headWith(
    "/__fixture/f1/raw/reset-before-headers",
    {},
    connection().socket,
  );
  const reply = handler(request);

  expect(reply?.bytes.length).toBe(0);
  expect(reply?.then).toBe("terminate");
  expect(f1.requests).toEqual([
    {
      endpoint: "raw:reset-before-headers",
      method: "GET",
      path: "/",
      headers: { host: "127.0.0.1" },
      rawHead: request.rawHead,
    },
  ]);
});

test("held raw connections are tracked and map actions to connection calls", async () => {
  const { registry, f1, handler } = open();
  const ended = connection();
  const first = handler(
    headWith("/__fixture/f1/raw/utf8-last-event-id/events/a", {}, ended.socket),
  );
  expect(first?.then).toBe("hold");
  const live = f1.live("raw:utf8-last-event-id");
  if (live === undefined) throw new Error("missing raw connection");
  expect(await live.apply("end")).toBe(true);
  expect(ended.write).toHaveBeenCalledWith(
    new TextEncoder().encode("0\r\n\r\n"),
  );
  expect(ended.end).toHaveBeenCalledTimes(1);
  expect(ended.terminate).not.toHaveBeenCalled();

  const dropped = connection();
  handler(
    headWith(
      "/__fixture/f1/raw/utf8-last-event-id/events/a",
      {},
      dropped.socket,
    ),
  );
  const drop = f1.live("raw:utf8-last-event-id");
  if (drop === undefined) throw new Error("missing raw connection");
  expect(await drop.apply("drop")).toBe(true);
  expect(dropped.write).not.toHaveBeenCalled();
  expect(dropped.end).toHaveBeenCalledTimes(1);
  expect(dropped.terminate).not.toHaveBeenCalled();

  const terminated = connection();
  handler(
    headWith(
      "/__fixture/f1/raw/utf8-last-event-id/events/a",
      {},
      terminated.socket,
    ),
  );
  const terminate = f1.live("raw:utf8-last-event-id");
  if (terminate === undefined) throw new Error("missing raw connection");
  expect(await terminate.apply("terminate")).toBe(true);
  expect(terminated.write).not.toHaveBeenCalled();
  expect(terminated.end).not.toHaveBeenCalled();
  expect(terminated.terminate).toHaveBeenCalledTimes(1);

  const released = connection();
  handler(
    headWith(
      "/__fixture/f1/raw/utf8-last-event-id/events/a",
      {},
      released.socket,
    ),
  );
  expect(f1.live("raw:utf8-last-event-id")).toBeDefined();
  await registry.delete("f1");
  expect(released.terminate).toHaveBeenCalledTimes(1);

  const fresh = createFixtureRegistry();
  const state = fresh.create("f1");
  createRawHandler(fresh)(head("/__fixture/f1/raw/truncated"));
  expect(state.live("raw:truncated")).toBeUndefined();
});
