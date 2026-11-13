// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withRetry,
} from "@defjs/core";

const client = createClient(
  withEndpoint("https://quotes.example.com"),
  withRetry({
    maxRetries: 3,
    attemptTimeoutMs: 5_000,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldRetry(context) {
      if (context.transport !== "websocket") return context.retryable;
      // A server that closed normally (1000) or refused with a policy violation (1008) would only repeat itself.
      return context.code !== 1000 && context.code !== 1008;
    },
  }),
);
const quotes = defineWebSocket({
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
