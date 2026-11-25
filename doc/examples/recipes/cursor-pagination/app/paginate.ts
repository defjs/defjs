// #region example
import type { AnyFault, DerivableClient } from "@defjs/core";
import { listOrders, type Order } from "../sdk/orders.ts";

export interface PaginateOrdersOptions {
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export async function* listAllOrders(
  client: DerivableClient,
  options: PaginateOrdersOptions = {},
): AsyncGenerator<[AnyFault, undefined] | [null, Order]> {
  let cursor: string | undefined;

  while (true) {
    const callClient = options.signal
      ? client({ signal: options.signal })
      : client;
    const [err, page] = await listOrders(callClient, {
      cursor,
      limit: options.limit,
    });
    if (err) {
      yield [err, undefined];
      return;
    }

    for (const order of page.items) {
      yield [null, order];
    }

    if (page.nextCursor === undefined) {
      return;
    }
    cursor = page.nextCursor;
  }
}
// #endregion
