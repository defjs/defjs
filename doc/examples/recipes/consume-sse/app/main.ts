// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { deployEvents } from "../sdk/deployments.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, stream] = await deployEvents(client);
  if (err) {
    console.error(err.code);
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
