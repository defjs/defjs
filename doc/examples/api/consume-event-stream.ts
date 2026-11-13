// #region example
import type { EventStreamHandle } from "@defjs/core";

export async function consume(
  handle: EventStreamHandle<unknown>,
): Promise<void> {
  await using stream = handle;
  for await (const event of stream) console.log(event);
}
// #endregion
