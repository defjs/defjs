// #region example
import type { DerivableClient } from "@defjs/core";
import { readProduct, type Product } from "../sdk/catalog.ts";

export function createReader(client: DerivableClient) {
  const cache = new Map<string, { etag: string; product: Product }>();

  return async (sku: string): Promise<[Error, undefined] | [null, Product]> => {
    const cached = cache.get(sku);
    const [err, product, response] = await readProduct(client, {
      sku,
      etag: cached?.etag,
    });

    if (err) {
      if (err.code === "HTTP_STATUS" && err.status === 304 && cached) {
        return [null, cached.product];
      }
      return [err, undefined];
    }

    const etag = response.headers.get("etag");
    if (!etag) return [new Error("missing etag header"), undefined];
    cache.set(sku, { etag, product });
    return [null, product];
  };
}
// #endregion
