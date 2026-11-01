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
  const [error, stream, startupOpen] = await notifications(client);
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
