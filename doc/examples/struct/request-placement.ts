// #region example
import { defineRequest, struct, type Client } from "@defjs/core";

const createOrder = defineRequest({
  method: "POST",
  path: "/organizations/:organizationId/orders",
  input: struct.object({
    organizationId: struct.string(),
    notify: struct.boolean().optional(),
    requestId: struct.string(),
    order: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { organizationId: input.organizationId },
    query: { notify: input.notify },
    headers: { "x-request-id": input.requestId },
    body: input.order,
  }),
});

async function submit(client: Client): Promise<Error | null> {
  const [err] = await createOrder(client, {
    organizationId: "acme",
    notify: true,
    requestId: "request-42",
    order: { customerName: "Ada" },
  });
  if (err) {
    return err;
  }
  return null;
}
// #endregion
