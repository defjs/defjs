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
  const [error, session, startupConnection] = await client.execute(command);
  if (error) {
    console.error(error.code, startupConnection?.generation);
    return;
  }
  await using ownedSession = session;
  const unsubscribe = ownedSession.onRuntimeError((cause) =>
    console.error("runtime", cause),
  );
  try {
    ownedSession.send({ type: "send", text: "Hello" });
    // wire: {"type":"send","text":"Hello"}
    for await (const message of ownedSession.receive) {
      console.log(message.type, message.text);
      break;
    }
  } finally {
    unsubscribe();
  }
}

void main();
// #endregion
