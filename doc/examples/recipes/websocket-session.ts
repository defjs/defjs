// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://chat.example.com"));

const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: "/chat",
  incoming: struct.object({
    type: struct.literal("message"),
    text: struct.string(),
  }),
  outgoing: struct.object({
    type: struct.literal("send"),
    text: struct.string(),
  }),
});

async function main() {
  const command = room();
  const [error, session] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  const unsubscribe = session.onRuntimeError((cause) =>
    console.error("runtime", cause),
  );
  try {
    session.send({ type: "send", text: "Hello" });
    for await (const message of session.receive) {
      console.log(message.type, message.text);
      break;
    }
  } finally {
    unsubscribe();
    session.close(1000, "consumer-finished");
    await session.closed;
  }
}

void main();
// #endregion
