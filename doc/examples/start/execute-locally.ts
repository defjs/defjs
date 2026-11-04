// #region example
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getOrder } from "./define-request.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- INTENT: preserve async rejection behavior for construction errors instead of introducing synchronous throws
const handle: FetchHandle = async (input, init) => {
  const request = new Request(input, init);
  const id = new URL(request.url).pathname.split("/").at(-1);

  if (id === "7") {
    return Response.json({ id: 7, status: "paid" }, { status: 200 });
  }

  return Response.json({ message: "Order not found" }, { status: 404 });
};

const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(handle),
);

async function main() {
  const [error, order, response] = await getOrder(
    client({ signal: AbortSignal.timeout(5_000) }),
    { id: 7 },
  );
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Loaded ${order.status} from ${response.status}`);
}

void main();
// #endregion
