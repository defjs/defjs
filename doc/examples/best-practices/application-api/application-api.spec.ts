import { expect, test } from "vitest";
import { createServerApiClient } from "./src/api/client.ts";
import { createOrder, getOrder, listOrders } from "./src/api/request/orders.ts";
import { placeAndLoadOrder } from "./src/checkout.ts";

test("in-app API layer keeps operation definitions pure while isolating per-request SSR clients", async () => {
  const [checkoutErr, checkoutResult] = await placeAndLoadOrder();
  expect(checkoutErr).toBeNull();
  expect(checkoutResult).toEqual({
    id: 101,
    status: "paid",
    totalOrders: 1,
  });

  const tenantAClient = createServerApiClient("token-tenant-a");
  const tenantBClient = createServerApiClient("token-tenant-b");

  const [createErr, created] = await createOrder(tenantAClient, {
    customerName: "Grace Hopper",
    totalCents: 6400,
    idempotencyKey: "idem-a-1",
  });
  expect(createErr).toBeNull();
  expect(created?.customerName).toBe("Grace Hopper");

  const [listErr, page] = await listOrders(tenantAClient, { status: "paid" });
  expect(listErr).toBeNull();
  expect(page?.items.length).toBe(1);

  const [unauthErr, absent] = await getOrder(tenantBClient, { id: 999 });
  expect(absent).toBeUndefined();
  expect(unauthErr?.code).toBe("HTTP_STATUS");
  if (unauthErr?.code === "HTTP_STATUS") {
    expect(unauthErr.status).toBe(404);
    expect(unauthErr.data.code).toBe("ORDER_NOT_FOUND");
  }
});
