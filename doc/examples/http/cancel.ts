// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getReport = defineRequest({ method: "GET", path: "/report" });

async function main() {
  const controller = new AbortController();
  const pending = getReport(
    client({
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    }),
  );

  controller.abort("screen closed");
  const [err] = await pending;
  if (err) {
    if (err.code === "NET_ABORTED") {
      console.log("caller cancellation");
      return;
    }
    console.error(err.code);
    return;
  }
}

void main();
// #endregion
