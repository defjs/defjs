// #region example
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { createReader } from "./reader.ts";

const etag = '"v7"';
const client = createClient(
  withEndpoint("https://catalog.example.test"),
  // Stands in for the server: it answers 304 once the request carries the current ETag.
  withHTTPHandle((input, init) => {
    if (new Request(input, init).headers.get("if-none-match") === etag) {
      return Promise.resolve(
        new Response(null, { status: 304, headers: { etag } }),
      );
    }
    return Promise.resolve(
      Response.json(
        { sku: "SKU-1", name: "Flask", priceCents: 3200 },
        { status: 200, headers: { etag } },
      ),
    );
  }),
);

const read = createReader(client);

async function main() {
  const [warmErr] = await read("SKU-1");
  if (warmErr) {
    console.error(warmErr);
    return;
  }
  const [revalidateErr, product] = await read("SKU-1");
  if (revalidateErr) {
    console.error(revalidateErr);
    return;
  }
  console.log(product.name);
}

void main();
// #endregion
