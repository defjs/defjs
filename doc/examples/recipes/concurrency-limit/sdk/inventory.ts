// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

export const Item = struct.object({
  id: struct.string(),
  stock: struct.number(),
});
export type Item = Infer<typeof Item>;

export const Summary = struct.object({
  totalSkus: struct.number().alias("total_skus"),
});
export type Summary = Infer<typeof Summary>;

export const getItem = defineRequest({
  method: "GET",
  path: "/items/:id",
  input: struct.object({ id: struct.string() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: Item,
});

export const getSummary = defineRequest({
  method: "GET",
  path: "/summary",
  output: Summary,
});
// #endregion
