// #region example
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle((input, init) => {
    const request = new Request(input, init);
    const id = new URL(request.url).pathname.split("/").at(-1);
    if (id === "7")
      return Promise.resolve(
        Response.json({ id: 7, status: "paid" }, { status: 200 }),
      );
    return Promise.resolve(
      Response.json({ message: "Order not found" }, { status: 404 }),
    );
  }),
);
async function main() {
  const [error, order, response] = await getOrder(client, { id: 7 });
  if (error) {
    // The test boundary rejects failures so the test process cannot pass.
    throw error;
  }
  console.log(order.status, response.status);
}

await main();
// #endregion
