// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getReport = defineRequest({ method: "GET", path: "/report" });

async function main() {
  const command = getReport();
  const controller = new AbortController();
  const pending = client.execute(command, {
    signal: controller.signal,
    timeout: 5_000,
  });

  controller.abort("screen closed");
  const [error] = await pending;
  if (error?.code === "NET_ABORTED") {
    console.log("caller cancellation");
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
}

void main();
// #endregion
