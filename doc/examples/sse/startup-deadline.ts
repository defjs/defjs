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

async function openDuringStartup(abortAfterMs: number): Promise<Error | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("startup deadline", "TimeoutError"));
  }, abortAfterMs);
  const [err, stream] = await deployEvents(
    client({ signal: controller.signal }),
  );
  clearTimeout(timer);
  if (err) {
    return err;
  }
  stream.close("opened");
  await stream.closed;
  return null;
}
// #endregion
