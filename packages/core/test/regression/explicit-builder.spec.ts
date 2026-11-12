import { expect, test } from "vitest";
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "../../src";

const Input = struct
  .object({ query: struct.object({ token: struct.string() }) })
  .optional();

test("input field names never imply placement; the builder alone decides", async () => {
  const endpoint = defineRequest({
    method: "POST",
    path: "/resource",
    input: Input,
    builder: (input) => ({ body: { token: input?.query.token ?? "default" } }),
  });
  const sent: { body: unknown; url: string }[] = [];
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (input, init) => {
      const request = new Request(input, init);
      sent.push({ body: await request.json(), url: request.url });
      return new Response(null, { status: 204 });
    }),
  );

  expect(
    (await endpoint(client, { query: { token: "body-only" } }))[0],
  ).toBeNull();
  expect((await endpoint(client))[0]).toBeNull();
  expect(sent).toEqual([
    { body: { token: "body-only" }, url: "https://example.test/resource" },
    { body: { token: "default" }, url: "https://example.test/resource" },
  ]);
});
