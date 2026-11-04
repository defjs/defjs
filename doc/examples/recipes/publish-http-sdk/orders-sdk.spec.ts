import { expect, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withHeaders,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getOrder } from "./orders-sdk";

test("one exported SDK endpoint uses each application's client and preserves typed failures", async () => {
  const requests: { url: string; authorization: string | null }[] = [];
  const handle: FetchHandle = (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
    });
    return Promise.resolve(
      new URL(request.url).hostname === "first.example.test"
        ? Response.json({ id: 7, status: "paid" })
        : Response.json({ message: "Order not found" }, { status: 404 }),
    );
  };
  const first = createClient(
    withEndpoint("https://first.example.test/v1"),
    withHeaders({ authorization: "Bearer first-fixture" }),
    withHTTPHandle(handle),
  );
  const second = createClient(
    withEndpoint("https://second.example.test/v2"),
    withHeaders({ authorization: "Bearer second-fixture" }),
    withHTTPHandle(handle),
  );

  expect(requests).toEqual([]);
  const [successError, order] = await getOrder(first, { id: 7 });
  const [missing, absent] = await getOrder(second, { id: 7 });

  expect(successError).toBeNull();
  expect(order).toEqual({ id: 7, status: "paid" });
  expect(absent).toBeUndefined();
  expect(missing?.code).toBe("HTTP_STATUS");
  if (missing?.code === "HTTP_STATUS") {
    expect(missing.status).toBe(404);
    expect(missing.data?.message).toBe("Order not found");
  }
  expect(requests).toEqual([
    {
      url: "https://first.example.test/v1/orders/7",
      authorization: "Bearer first-fixture",
    },
    {
      url: "https://second.example.test/v2/orders/7",
      authorization: "Bearer second-fixture",
    },
  ]);
});
