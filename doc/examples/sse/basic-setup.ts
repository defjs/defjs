// #region example
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: "/notifications",
  events: {
    message: struct.object({ text: struct.string() }),
  },
});

const [error, stream] = await client.execute(notifications());
if (error) {
  console.error(error.code);
} else {
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    if (event.event === "message") console.log(event.data.text);
  }
}
// #endregion
