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
  events: { line: struct.string() },
});

async function main() {
  const [error, stream, startupOpen] = await deployEvents(client);
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
