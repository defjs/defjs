import { expect, inject, test } from "vitest";
import { createClient, withEndpoint } from "../client";
import { struct } from "../struct";
import { defineRequest } from "./http";

test("default GET fails over from a refused origin in real browsers", async () => {
  const client = createClient(
    withEndpoint("http://127.0.0.1:1", inject("testServerHost")),
  );
  const [error, result] = await defineRequest({
    method: "GET",
    path: "/json",
    output: struct.object({ id: struct.number() }),
  })(client);
  expect(error).toBeNull();
  expect(result).toEqual({ id: 1 });
});
