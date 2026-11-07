// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getReport } from "../sdk/reports.ts";

const client = createClient(withEndpoint("https://api.example.com"));

const controller = new AbortController();
const pending = getReport(
  client({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
  }),
);

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
