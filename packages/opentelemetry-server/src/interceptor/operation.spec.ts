import type { OperationCall } from "@defjs/core";
import { describe, expect, test } from "vitest";
import { operationName } from "./operation";

describe("operationName", () => {
  test.each<[OperationCall, string]>([
    [
      {
        transport: "http",
        method: "GET",
        path: "/orders/:id",
        meta: undefined,
      },
      "GET /orders/:id",
    ],
    [
      { transport: "http", method: "get", path: "/orders", meta: undefined },
      "GET /orders",
    ],
    [
      {
        transport: "http",
        method: "PROPFIND",
        path: "/files",
        meta: undefined,
      },
      "HTTP /files",
    ],
    [
      { transport: "sse", method: "POST", path: "/events", meta: undefined },
      "SSE /events",
    ],
    [
      { transport: "websocket", method: "GET", path: "/chat", meta: undefined },
      "WebSocket /chat",
    ],
  ])("names %o as %s", (call, name) => {
    expect(operationName(call)).toBe(name);
  });
});
