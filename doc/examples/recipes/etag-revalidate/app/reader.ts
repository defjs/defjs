// #region example
import type { DerivableClient } from "@defjs/core";
import { readProduct, type Product } from "../sdk/catalog.ts";

export function createReader(client: DerivableClient) {
  const cache = new Map<string, { etag: string; product: Product }>();

  return async (sku: string): Promise<Product> => {
    const cached = cache.get(sku);
    const [error, product, response] = await readProduct(client, {
      sku,
      etag: cached?.etag,
    });

    if (error?.code === "HTTP_STATUS" && error.status === 304 && cached) {
      return cached.product;
    }
    // This reader returns Product, so a non-304 fault leaves here by throwing.
    if (error) throw error;

    const etag = response.headers.get("etag");
    if (!etag) throw new Error("missing ETag");
    cache.set(sku, { etag, product });
    return product;
  };
}
// #endregion
