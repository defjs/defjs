// #region example
import type { Client } from "@defjs/core";
import { runViewer } from "../sdk/viewer.ts";

type Viewer = { id: string; login: string };

export async function loadViewer(
  client: Client,
): Promise<[Error, undefined] | [null, Viewer | null]> {
  const [err, result] = await runViewer(client);
  if (err) return [err, undefined];
  // GraphQL errors ride in the HTTP 200 envelope, so they are not Defjs faults.
  if (result.errors?.length) {
    const message = result.errors.map((item) => item.message).join("; ");
    return [new Error(message), undefined];
  }
  if (!result.data) {
    return [
      new Error("graphql response contained neither data nor errors"),
      undefined,
    ];
  }
  return [null, result.data.viewer];
}
// #endregion
