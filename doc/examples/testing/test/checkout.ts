// #region example
import { expect, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import { bearerAuth, checkoutOrder } from "../src/checkout.ts";

test("checkoutOrder attaches bearer auth, maps wire fields, and returns the order", async () => {
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withInterceptors(bearerAuth("test-token")),
    withHTTPHandle(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://fixture.invalid/orders");
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      expect(request.headers.get("idempotency-key")).toBe("idem-1");
      const body: unknown = await request.json();
      expect(body).toEqual({ customer_name: "Ada" });

      return Response.json({ id: 42, customer_name: "Ada" }, { status: 201 });
    }),
  );

  const [err, result] = await checkoutOrder(client, {
    customerName: "Ada",
    idempotencyKey: "idem-1",
  });
  expect(err).toBeNull();
  if (err) throw err;
  expect(result).toEqual({ orderId: 42, customerName: "Ada" });
});

test("checkoutOrder translates a 409 conflict into a domain error", async () => {
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withHTTPHandle(() =>
      Promise.resolve(
        Response.json({ message: "Order already paid" }, { status: 409 }),
      ),
    ),
  );

  const [err, result] = await checkoutOrder(client, {
    customerName: "Ada",
    idempotencyKey: "idem-1",
  });
  if (err) {
    expect(result).toBeUndefined();
    expect(err.message).toBe("duplicate order: Order already paid");
    return;
  }
  expect.unreachable("expected duplicate order error");
});
// #endregion
