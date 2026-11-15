import { inject } from "vitest";
import { fixture } from "./fixture/client-auto.ts";
import type { ScenarioParams } from "./fixture/types.ts";

/** The `incoming` frames the chat tests decode: `{ type, ...payload }` as JSON. */
export function socketMessage(type: string, payload: object): string {
  return JSON.stringify({ type, ...payload });
}

/**
 * A WebSocket endpoint of the fixture server for this test. Its server sends `params.send` when the socket opens and
 * never closes on its own: `end()` sends `params.end.send` and closes, so a test calls it after it has seen the
 * session open and attached its listeners. Connect to `endpoint` with the path `/ws`.
 */
export async function webSocketEndpoint(
  params: ScenarioParams["ws"],
): Promise<{ endpoint: string; end: () => Promise<void> }> {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const endpoint = await f.endpoint("ws", "ws", params);
  return { endpoint, end: () => f.act("ws", "end") };
}
