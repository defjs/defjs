// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://quotes.example.com"));
const quotes = defineWebSocket({
  path: "/quotes",
  incoming: struct.discriminatedUnion("type", [
    struct.object({ type: struct.literal("pong"), ok: struct.boolean() }),
  ]),
  outgoing: struct.object({ type: struct.literal("ping") }),
});

async function main() {
  const [error, session] = await quotes(
    client({
      heartbeat: {
        intervalMs: 30_000,
        timeoutMs: 10_000,
        message: () => ({ type: "ping" as const }),
        isAck: (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "pong",
      },
    }),
  );
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedSession = session;
  console.log(ownedSession.state);
}

void main();
// #endregion
