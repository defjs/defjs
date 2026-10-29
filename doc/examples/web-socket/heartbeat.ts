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
  incoming: struct.discriminatedUnion("type", [
    struct.object({ type: struct.literal("pong"), ok: struct.boolean() }),
  ]),
  outgoing: struct.object({ type: struct.literal("ping") }),
});

async function main() {
  const command = room();
  const [error, session] = await client.execute(command, {
    heartbeat: {
      intervalMs: 30_000,
      timeoutMs: 10_000,
      message: () => ({ type: "ping" as const }),
      isAck: (message) => message.type === "pong",
    },
  });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(session.state);
  session.close(1000, "done");
}

void main();
// #endregion
