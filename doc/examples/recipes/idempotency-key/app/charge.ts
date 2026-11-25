// #region example
import {
  createClient,
  idempotencyKeyHttpInterceptor,
  withEndpoint,
  withInterceptors,
  withRetry,
  type AnyFault,
  type Client,
  type ClientOption,
} from "@defjs/core";
import {
  createCharge,
  type Charge,
  type ChargeInput,
} from "../sdk/payments.ts";

export function createPaymentsClient(
  endpoint: string,
  ...extra: ClientOption[]
): Client {
  return createClient(
    withEndpoint(endpoint),
    withRetry({
      maxRetries: 2,
      methods: ["GET", "HEAD", "POST"],
    }),
    withInterceptors(idempotencyKeyHttpInterceptor()),
    ...extra,
  );
}

export async function submitCharge(
  client: Client,
  input: ChargeInput,
): Promise<[AnyFault, undefined] | [null, Charge]> {
  const [err, charge] = await createCharge(client, input);
  if (err) {
    return [err, undefined];
  }
  return [null, charge];
}
// #endregion
