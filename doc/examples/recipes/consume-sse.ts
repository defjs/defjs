// #region example
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));

const deployEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: "/deployments/events",
  events: {
    line: struct.object({ text: struct.string() }),
  },
});

async function main() {
  const [error, stream] = await deployEvents(client);
  if (error) {
    console.error(error.code);
    return;
  }
  try {
    for await (const event of stream) {
      if (event.event === "line") {
        console.log(event.data.text);
        break;
      }
    }
  } finally {
    stream.close("consumer-finished");
    await stream.closed;
  }
}

void main();
// #endregion
