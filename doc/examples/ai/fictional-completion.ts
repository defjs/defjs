// #region example
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
  withSSEHandle,
} from "@defjs/core";

const completion = defineEventStream({
  method: "POST",
  path: "/complete",
  input: struct.object({ prompt: struct.string() }),
  builder: (input) => ({ body: input }),
  events: {
    delta: struct.object({ text: struct.string() }),
    done: struct.object({ reason: struct.string() }),
  },
});

const wire = [
  "event: delta",
  'data: {"text":"Hello"}',
  "",
  "event: delta",
  'data: {"text":" there"}',
  "",
  "event: done",
  'data: {"reason":"stop"}',
  "",
  "",
].join("\n");

const client = createClient(
  withEndpoint("https://fiction.example"),
  withSSEHandle(
    async () =>
      new Response(wire, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
  ),
);

async function main() {
  const [error, stream] = await completion(client, { prompt: "hello" });
  if (error) {
    console.error(error.code);
    return;
  }

  let answer = "";
  let complete = false;
  try {
    for await (const event of stream) {
      if (event.event === "delta") answer += event.data.text;
      if (event.event === "done") {
        complete = true;
        break;
      }
    }
  } catch (cause) {
    console.error(
      "Stream failed",
      cause instanceof Error ? cause.name : "unknown",
    );
    return;
  } finally {
    stream.close("consumer-finished");
    await stream.closed;
  }
  if (!complete) {
    console.error("Stream ended before the completion event");
    return;
  }
  console.log(answer);
}

void main();
// #endregion
