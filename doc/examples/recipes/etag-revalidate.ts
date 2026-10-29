// #region example
import {
  createClient,
  defineRequest,
  struct,
  type Infer,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const Product = struct.object({
  sku: struct.string(),
  name: struct.string(),
  priceCents: struct.number(),
});

type Product = Infer<typeof Product>;

const readProduct = defineRequest({
  method: "GET",
  path: "/catalog/:sku",
  input: struct.object({
    sku: struct.string(),
    etag: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { sku: input.sku },
    headers: { "If-None-Match": input.etag },
  }),
  output: Product,
});

function createReader(client: ReturnType<typeof createClient>) {
  const cache = new Map<string, { etag: string; product: Product }>();

  return async (sku: string): Promise<Product> => {
    const cached = cache.get(sku);
    const [error, product, response] = await client.execute(
      readProduct({ sku, etag: cached?.etag }),
    );

    if (error?.code === "HTTP_STATUS" && error.status === 304 && cached) {
      return cached.product;
    }
    if (error) throw error;

    const etag = response.headers.get("etag");
    if (!etag) throw new Error("missing ETag");
    cache.set(sku, { etag, product });
    return product;
  };
}

const etag = '"v7"';
const client = createClient(
  withEndpoint("https://catalog.example.test"),
  withHTTPHandle(async (input, init) => {
    if (new Request(input, init).headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    return Response.json(
      { sku: "SKU-1", name: "Flask", priceCents: 3200 },
      { status: 200, headers: { etag } },
    );
  }),
);
const read = createReader(client);
await read("SKU-1");
const product = await read("SKU-1");
console.log(product.name);
// #endregion
