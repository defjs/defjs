// #region example
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import { getInvoice } from "../sdk/billing.ts";
import { refreshingBearer, type Credential } from "./auth-interceptor.ts";

let credential: Credential = { accessToken: "v1" };
const client = createClient(
  withEndpoint("https://billing.example.test"),
  // Stands in for the server: it rejects the stale token and accepts any other.
  withHTTPHandle((input, init) => {
    const auth = new Request(input, init).headers.get("authorization");
    if (auth === "Bearer v1")
      return Promise.resolve(
        Response.json({ code: "expired_token" }, { status: 401 }),
      );
    return Promise.resolve(Response.json({ total: 42 }, { status: 200 }));
  }),
  withInterceptors(
    refreshingBearer(
      () => credential,
      () => {
        credential = { accessToken: "v2" };
        return Promise.resolve(credential);
      },
    ),
  ),
);

async function main() {
  const [error, invoice] = await getInvoice(client);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(invoice.total);
}

void main();
// #endregion
