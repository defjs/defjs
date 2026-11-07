// #region example
import type { Client } from "@defjs/core";
import { runViewer } from "../sdk/viewer.ts";

export async function loadViewer(client: Client) {
  const [error, result] = await runViewer(client);
  if (error) throw error;
  if (result.errors?.length) {
    throw new Error(result.errors.map((item) => item.message).join("; "));
  }
  if (!result.data) {
    throw new Error("GraphQL response contained neither data nor errors");
  }
  return result.data.viewer;
}
// #endregion
