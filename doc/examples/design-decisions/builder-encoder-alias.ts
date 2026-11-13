// #region example
import { defineRequest, struct, type Client } from "@defjs/core";

const createBatch = defineRequest({
  method: "POST",
  path: "/accounts/:account_id/orders",
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    orders: struct.array(
      struct.object({
        customerName: struct.string().alias("customer_name"),
        totalCents: struct.number().alias("total_cents"),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { "x-api-version": "2" },
    body: { orders: input.orders },
  }),
  output: struct.object({ accepted: struct.number() }),
});

async function submit(
  client: Client,
): Promise<[Error, undefined] | [null, number]> {
  const [err, result] = await createBatch(client, {
    accountId: 42,
    orders: [{ customerName: "Ada", totalCents: 4200 }],
  });
  if (err) {
    return [err, undefined];
  }
  return [null, result.accepted];
}
// #endregion
