import "../testing/deadline.ts";
import "../testing/sse.ts";
import "../testing/test/checkout.ts";
import "../testing/test/orders.ts";
import "../testing/websocket.ts";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import { expect, test } from "vitest";
import { createServer } from "node:http";
import type { Pool } from "undici";
import {
  createInventoryClient,
  loadDashboard,
  loadItems,
} from "./concurrency-limit/app/batch.ts";
import { listAllOrders } from "./cursor-pagination/app/paginate.ts";
import { createReader } from "./etag-revalidate/app/reader.ts";
import { loadViewer } from "./graphql-http-envelope/app/load-viewer.ts";
import {
  createPaymentsClient,
  submitCharge,
} from "./idempotency-key/app/charge.ts";
import {
  refreshingBearer,
  type Credential,
} from "./refresh-bearer-once/app/auth-interceptor.ts";
import { getInvoice } from "./refresh-bearer-once/sdk/billing.ts";
import { createUndiciPoolHandle } from "./undici-pool/app/pool-handle.ts";
import { getOrder as getUndiciOrder } from "./undici-pool/sdk/orders.ts";

/** A local server that records the status of every response it gives. */
function recordingServer(respond: (request: Request) => Response) {
  const statuses: number[] = [];
  const handle = withHTTPHandle((input, init) => {
    const response = respond(new Request(input, init));
    statuses.push(response.status);
    return Promise.resolve(response);
  });
  return { handle, statuses };
}

test("ETag recipe reuses the cached product after a real 304", async () => {
  const etag = '"v7"';
  const server = recordingServer((request) =>
    request.headers.get("if-none-match") === etag
      ? new Response(null, { status: 304, headers: { etag } })
      : Response.json(
          { sku: "SKU-1", name: "Flask", priceCents: 3200 },
          { headers: { etag } },
        ),
  );
  const read = createReader(
    createClient(withEndpoint("https://catalog.example.test"), server.handle),
  );

  const [warmErr] = await read("SKU-1");
  const [revalidateErr, product] = await read("SKU-1");

  expect(server.statuses).toEqual([200, 304]);
  expect(warmErr).toBeNull();
  expect(revalidateErr).toBeNull();
  expect(product?.name).toBe("Flask");
});

test("Bearer recipe refreshes the credential after a real 401", async () => {
  let credential: Credential = { accessToken: "v1" };
  const server = recordingServer((request) =>
    request.headers.get("authorization") === "Bearer v1"
      ? Response.json({ code: "expired_token" }, { status: 401 })
      : Response.json({ total: 42 }),
  );
  const client = createClient(
    withEndpoint("https://billing.example.test"),
    server.handle,
    withInterceptors(
      refreshingBearer(
        () => credential,
        () => {
          credential = { accessToken: "v2" };
          return Promise.resolve(credential);
        },
      ),
    ),
  );

  const [err, invoice] = await getInvoice(client);

  expect(server.statuses).toEqual([401, 200]);
  expect(credential.accessToken).toBe("v2");
  expect(err).toBeNull();
  expect(invoice).toEqual({ total: 42 });
});

test("GraphQL recipe unwraps data: null with errors as an application error", async () => {
  const envelopes = [
    { data: { viewer: { id: "v-1", login: "ada" } } },
    { errors: [{ message: "viewer unavailable" }] },
    { data: null, errors: [{ message: "viewer unavailable" }] },
  ];
  let calls = 0;
  const server = recordingServer(() => Response.json(envelopes[calls++]));
  const client = createClient(
    withEndpoint("https://api.example.test"),
    server.handle,
  );

  const [viewerErr, viewer] = await loadViewer(client);
  const [missingErr, missing] = await loadViewer(client);
  const [nullDataErr, nullData] = await loadViewer(client);

  expect(server.statuses).toEqual([200, 200, 200]);
  expect(viewerErr).toBeNull();
  expect(viewer).toEqual({ id: "v-1", login: "ada" });
  expect(missing).toBeUndefined();
  expect(missingErr).toHaveProperty("message", "viewer unavailable");
  expect(nullData).toBeUndefined();
  expect(nullDataErr).toBeInstanceOf(Error);
  expect(nullDataErr).toHaveProperty("message", "viewer unavailable");
  // A Defjs fault carries `code`; this is the helper's own application error.
  expect(nullDataErr).not.toHaveProperty("code");
});

test("cursor-pagination walks all pages and propagates mid-stream fault or abort", async () => {
  const pages = [
    {
      items: [
        { id: "o-1", total_cents: 1200 },
        { id: "o-2", total_cents: 2400 },
      ],
      next_cursor: "c-2",
    },
    {
      items: [{ id: "o-3", total_cents: 3600 }],
    },
  ];
  const cursorsSeen: (string | null)[] = [];
  const server = recordingServer((request) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    cursorsSeen.push(cursor);
    if (cursor === "fail") {
      return Response.json({ message: "boom" }, { status: 500 });
    }
    const payload = cursor === "c-2" ? pages[1] : pages[0];
    return Response.json(payload);
  });
  const client = createClient(
    withEndpoint("https://api.example.test"),
    server.handle,
  );

  const collected = [];
  for await (const [err, order] of listAllOrders(client, { limit: 2 })) {
    expect(err).toBeNull();
    if (order) collected.push(order);
  }
  expect(cursorsSeen).toEqual([null, "c-2"]);
  expect(collected).toEqual([
    { id: "o-1", totalCents: 1200 },
    { id: "o-2", totalCents: 2400 },
    { id: "o-3", totalCents: 3600 },
  ]);

  const failServer = recordingServer(() =>
    Response.json({ message: "server error" }, { status: 500 }),
  );
  const failClient = createClient(
    withEndpoint("https://api.example.test"),
    failServer.handle,
  );
  const failedResults = [];
  for await (const entry of listAllOrders(failClient)) {
    failedResults.push(entry);
  }
  expect(failedResults).toHaveLength(1);
  expect(failedResults[0]?.[0]?.code).toBe("HTTP_STATUS");

  const controller = new AbortController();
  controller.abort("done");
  const aborted = [];
  for await (const entry of listAllOrders(client, {
    signal: controller.signal,
  })) {
    aborted.push(entry);
  }
  expect(aborted[0]?.[0]?.code).toBe("NET_ABORTED");
});

test("idempotency-key reuses the same key on 429 retry and mints a fresh key for the next call", async () => {
  const keysSeen: (string | null)[] = [];
  let attempt = 0;
  const server = recordingServer((request) => {
    attempt += 1;
    keysSeen.push(request.headers.get("idempotency-key"));
    if (attempt === 1) {
      return new Response("slow down", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }
    return Response.json(
      { id: `ch-${attempt}`, status: "succeeded" },
      { status: 201 },
    );
  });

  const client = createPaymentsClient(
    "https://pay.example.test",
    server.handle,
  );

  const [err1, charge1] = await submitCharge(client, {
    orderId: "ord-1",
    amountCents: 5000,
  });
  expect(err1).toBeNull();
  expect(charge1).toEqual({ id: "ch-2", status: "succeeded" });

  const [err2, charge2] = await submitCharge(client, {
    orderId: "ord-2",
    amountCents: 2500,
  });
  expect(err2).toBeNull();
  expect(charge2).toEqual({ id: "ch-3", status: "succeeded" });

  expect(server.statuses).toEqual([429, 201, 201]);
  expect(keysSeen[0]).toBeTruthy();
  expect(keysSeen[0]).toBe(keysSeen[1]);
  expect(keysSeen[2]).toBeTruthy();
  expect(keysSeen[2]).not.toBe(keysSeen[0]);
});

test("concurrency-limit caps simultaneous HTTP calls and decodes concurrent batches", async () => {
  let active = 0;
  let maxActive = 0;
  const client = createInventoryClient(
    "https://inv.example.test",
    withHTTPHandle(async (input, init) => {
      const request = new Request(input, init);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((r) => setTimeout(r, 15));
        const pathname = new URL(request.url).pathname;
        if (pathname === "/summary") {
          return Response.json({ total_skus: 99 });
        }
        const id = pathname.slice("/items/".length);
        return Response.json({ id, stock: 7 });
      } finally {
        active -= 1;
      }
    }),
  );

  const [itemsErr, items] = await loadItems(client, [
    "sku-1",
    "sku-2",
    "sku-3",
    "sku-4",
    "sku-5",
  ]);
  expect(itemsErr).toBeNull();
  expect(items).toEqual([
    { id: "sku-1", stock: 7 },
    { id: "sku-2", stock: 7 },
    { id: "sku-3", stock: 7 },
    { id: "sku-4", stock: 7 },
    { id: "sku-5", stock: 7 },
  ]);
  expect(maxActive).toBeLessThanOrEqual(2);

  const [dashErr, dash] = await loadDashboard(client, "sku-top");
  expect(dashErr).toBeNull();
  expect(dash).toEqual({
    summary: { totalSkus: 99 },
    featured: { id: "sku-top", stock: 7 },
  });
});

interface UndiciPoolModule {
  readonly Pool: typeof Pool;
}

function isPoolConstructor(value: unknown): value is typeof Pool {
  return typeof value === "function";
}

function extractUndiciPool(mod: unknown): UndiciPoolModule {
  if (typeof mod === "object" && mod !== null && "Pool" in mod) {
    const candidate = mod.Pool;
    if (isPoolConstructor(candidate)) {
      return { Pool: candidate };
    }
  }
  throw new Error("Failed to load npm undici Pool constructor");
}

test("undici-pool executes real HTTP requests over pooled connections and handles edge cases", async () => {
  let receivedPostBody = "";
  const srv = createServer((req, res) => {
    if (req.url === "/orders/ord-9") {
      res.writeHead(200, {
        "content-type": "application/json",
        "x-multi": ["a", "b"],
      });
      res.end(JSON.stringify({ id: "ord-9", status: "shipped" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      receivedPostBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(204, { "x-arr": ["1", "2"] });
      res.end();
    });
  });
  await new Promise<void>((resolveReady) => {
    srv.listen(0, "127.0.0.1", () => resolveReady());
  });
  const addr = srv.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const undiciUrl = new URL(
    "../../node_modules/undici/index.js",
    import.meta.url,
  ).href;
  const { Pool: RealPool } = extractUndiciPool(await import(undiciUrl));
  const pool = new RealPool(baseUrl, { connections: 4 });
  try {
    const poolHandle = createUndiciPoolHandle(pool);
    const client = createClient(
      withEndpoint(baseUrl),
      withHTTPHandle(poolHandle),
    );
    const [err, order] = await getUndiciOrder(client, { id: "ord-9" });
    expect(err).toBeNull();
    expect(order).toEqual({ id: "ord-9", status: "shipped" });

    // Exercise direct Request input, POST body, and 204 null-body status handling via real Pool
    const req = new Request(`${baseUrl}/submit`, {
      method: "POST",
      headers: { "x-test": "1" },
      body: "hello",
    });
    const postRes = await poolHandle(req);
    expect(postRes.status).toBe(204);
    expect(postRes.headers.get("x-arr")).toBe("1, 2");
    expect(receivedPostBody).toBe("hello");

    const badReq = new Request(`${baseUrl}/bad`);
    Object.defineProperty(badReq, "method", { value: "CUSTOM" });
    await expect(poolHandle(badReq)).rejects.toThrow("Unsupported HTTP method");
  } finally {
    await pool.close();
    srv.closeAllConnections();
    await new Promise<void>((resolveClosed) => {
      srv.close(() => resolveClosed());
    });
  }
});
