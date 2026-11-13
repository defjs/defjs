// #region example
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const watchOrders = defineEventStream({
  path: "/orders/events",
  events: { order: struct.object({ id: struct.number() }) },
});
const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, stream] = await watchOrders(client);
  if (err) {
    console.error(err.code);
    return;
  }
  await using ownedStream = stream;
  try {
    for await (const event of ownedStream) {
      console.log(event.data.id);
      break;
    }
  } catch (cause) {
    console.error("watchOrders failed", cause);
  }
}

void main();
// #endregion
