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

async function openDuringStartup(abortAfterMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("startup deadline", "TimeoutError"));
  }, abortAfterMs);
  const [error, stream] = await deployEvents(
    client({ signal: controller.signal }),
  );
  clearTimeout(timer);
  if (error) {
    console.error(error.code);
    return;
  }
  stream.close("opened");
  await stream.closed;
}
// #endregion
