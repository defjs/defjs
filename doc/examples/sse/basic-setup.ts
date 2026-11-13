// #region example
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const deployEvents = defineEventStream({
  path: "/deployments/events",
  events: {
    line: struct.object({ text: struct.string() }),
  },
});

async function main() {
  const [err, stream] = await deployEvents(client);
  if (err) {
    console.error(err.code);
    return;
  }
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    if (event.event === "line") console.log(event.data.text);
  }
}

void main();
// #endregion
