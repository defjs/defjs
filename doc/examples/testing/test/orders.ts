// #region example
import { expect, test } from "vitest";
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

function makeTestClient() {
  return createClient(
    withEndpoint("https://fixture.invalid"),
    withHTTPHandle((input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("GET");
      if (new URL(request.url).pathname === "/orders/7") {
        return Promise.resolve(Response.json({ id: 7, status: "paid" }));
      }
      return Promise.resolve(
        Response.json({ message: "Order not found" }, { status: 404 }),
      );
    }),
  );
}

test("getOrder decodes the successful response", async () => {
  const client = makeTestClient();
  const [err, order, response] = await getOrder(client, { id: 7 });
  expect(err).toBeNull();
  if (err) throw err;
  expect(order).toEqual({ id: 7, status: "paid" });
  expect(response.status).toBe(200);
});

test("getOrder decodes the declared error response", async () => {
  const client = makeTestClient();
  const [err, order, response] = await getOrder(client, { id: 8 });
  if (err) {
    expect(order).toBeUndefined();
    expect(response).toBeUndefined();
    expect(err.code).toBe("HTTP_STATUS");
    if (err.code === "HTTP_STATUS") {
      expect(err.status).toBe(404);
      expect(err.data).toEqual({ message: "Order not found" });
      expect(err.response.status).toBe(404);
    }
    return;
  }
  expect.unreachable("expected HTTP_STATUS");
});
// #endregion
