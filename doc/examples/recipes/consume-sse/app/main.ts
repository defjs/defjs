// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { deployEvents } from "../sdk/deployments.ts";

const client = createClient(withEndpoint("https://api.example.com"));

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
