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

async function main() {
  const command = notifications();
  const [error, stream] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    if (event.event === "message") console.log(event.data.text);
  }
}

void main();
// #endregion
