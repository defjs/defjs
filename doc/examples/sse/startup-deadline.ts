// #region example
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: "/notifications",
  events: { message: struct.string() },
});

async function openDuringStartup(abortAfterMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("startup deadline", "TimeoutError"));
  }, abortAfterMs);
  const [error, stream] = await notifications(
    client({ abort: controller.signal }),
  );
  clearTimeout(timer);
  if (error) {
    console.error(error.code);
    return;
  }
  stream.close("opened");
  await stream.closed;
}

void openDuringStartup;
// #endregion
