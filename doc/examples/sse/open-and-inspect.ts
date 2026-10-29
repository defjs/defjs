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
  events: { message: struct.string() },
});

async function main() {
  const command = notifications();
  const [error, stream, startupOpen] = await client.execute(command);
  if (error) {
    console.error(error.code, startupOpen?.response.status);
    return;
  }
  console.log(
    stream.open.response.status,
    startupOpen.response.status,
    stream.open.url,
  );
  stream.close("example-finished");
  await stream.closed;
}

void main();
// #endregion
