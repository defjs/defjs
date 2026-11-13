import "../testing/deadline.ts";
import "../testing/test/orders.ts";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import { expect, test } from "vitest";
import { createReader } from "./etag-revalidate/app/reader.ts";
import { loadViewer } from "./graphql-http-envelope/app/load-viewer.ts";
import {
  refreshingBearer,
  type Credential,
} from "./refresh-bearer-once/app/auth-interceptor.ts";
import { getInvoice } from "./refresh-bearer-once/sdk/billing.ts";

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
