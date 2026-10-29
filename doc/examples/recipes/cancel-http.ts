// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getReport = defineRequest({ method: "GET", path: "/report" });

const controller = new AbortController();
const pending = client.execute(getReport(), {
  signal: controller.signal,
  timeout: 5_000,
});

controller.abort("screen closed");
const [error] = await pending;

if (error?.code === "NET_ABORTED") {
  console.log("caller cancelled");
} else if (error?.code === "NET_TIMEOUT") {
  console.log("timed out");
} else if (error) {
  console.error(error.code);
} else {
  console.log("got the report");
}
// #endregion
