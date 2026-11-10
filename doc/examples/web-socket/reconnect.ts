// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketReconnect,
} from "@defjs/core";

const client = createClient(
  withEndpoint("https://quotes.example.com"),
  withWebSocketReconnect({
    attempts: 3,
    connectTimeoutMs: 5_000,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      // `wasClean: true` does not mean the application close was healthy: 1011 is clean too.
      return (
        attempt <= 3 && (wasClean !== true || code === 1006 || code === 1011)
      );
    },
  }),
);
const quotes = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: "/quotes",
  incoming: struct.object({
    type: struct.literal("ready"),
    ok: struct.boolean(),
  }),
});
async function main() {
  const [error, session] = await quotes(client);
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedSession = session;
  console.log(ownedSession.state);
}

void main();
// #endregion
