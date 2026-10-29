// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketReconnect,
} from "@defjs/core";

const client = createClient(
  withEndpoint("https://chat.example.com"),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      return attempt <= 3 && (wasClean !== true || code === 1006);
    },
  }),
);
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: "/chat",
  incoming: struct.object({
    type: struct.literal("ready"),
    ok: struct.boolean(),
  }),
});
async function main() {
  const command = room();
  const [error, session] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(session.state);
  session.close(1000, "done");
}

void main();
// #endregion
