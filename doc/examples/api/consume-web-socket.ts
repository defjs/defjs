// #region consume
import type { WebSocketSession } from "@defjs/core";

export async function consume(
  session: WebSocketSession<unknown, never>,
): Promise<void> {
  await using ownedSession = session;
  for await (const message of ownedSession.receive) console.log(message);
}
// #endregion

// #region send
type SubscribeCommand = { type: "subscribe"; symbol: string };

export function subscribe(
  session: WebSocketSession<never, SubscribeCommand>,
): void {
  session.send({ type: "subscribe", symbol: "ACME" });
}
// #endregion
