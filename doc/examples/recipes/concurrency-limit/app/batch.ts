// #region example
import {
  concurrencyLimitHttpInterceptor,
  createClient,
  withEndpoint,
  withInterceptors,
  type AnyFault,
  type Client,
  type ClientOption,
} from "@defjs/core";
import { concurrentAll, concurrentMap } from "@defjs/core/concurrent";
import {
  getItem,
  getSummary,
  type Item,
  type Summary,
} from "../sdk/inventory.ts";

export function createInventoryClient(
  endpoint: string,
  ...extra: ClientOption[]
): Client {
  return createClient(
    withEndpoint(endpoint),
    withInterceptors(
      concurrencyLimitHttpInterceptor({ maxConcurrency: 2, maxQueue: 10 }),
    ),
    ...extra,
  );
}

export async function loadItems(
  client: Client,
  ids: readonly string[],
): Promise<[AnyFault, undefined] | [null, readonly Item[]]> {
  const [err, items] = await concurrentMap(
    client,
    getItem,
    ids.map((id) => ({ id })),
    { concurrency: 2 },
  );
  if (err) {
    return [err, undefined];
  }
  return [null, items];
}

export async function loadDashboard(
  client: Client,
  featuredId: string,
): Promise<
  [AnyFault, undefined] | [null, { summary: Summary; featured: Item }]
> {
  const [err, data] = await concurrentAll(client, {
    summary: (c) => getSummary(c),
    featured: (c) => getItem(c, { id: featuredId }),
  });
  if (err) {
    return [err, undefined];
  }
  return [null, data];
}
// #endregion
