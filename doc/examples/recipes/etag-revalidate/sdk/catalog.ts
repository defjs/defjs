// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

export const Product = struct.object({
  sku: struct.string(),
  name: struct.string(),
  priceCents: struct.number(),
});

export type Product = Infer<typeof Product>;

export const readProduct = defineRequest({
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
// #endregion
