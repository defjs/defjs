// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getReport = defineRequest({ method: "GET", path: "/report" });

const controller = new AbortController();
const command = getReport();
const pending = client.execute(command, {
  signal: controller.signal,
  timeout: 5_000,
});

controller.abort("screen closed");

async function main() {
  const [error] = await pending;
  if (error?.code === "NET_ABORTED") {
    console.log("caller cancelled");
    return;
  }
  if (error?.code === "NET_TIMEOUT") {
    console.log("timed out");
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log("got the report");
}

void main();
// #endregion
