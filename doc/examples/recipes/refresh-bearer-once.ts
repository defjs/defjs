// #region example
import {
  createClient,
  createHttpInterceptor,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";

const getInvoice = defineRequest({
  method: "GET",
  path: "/v1/invoice",
  output: struct.object({ total: struct.number() }),
  error: struct.object({ code: struct.literal("expired_token") }),
});

type Credential = { accessToken: string };

function refreshingBearer(
  read: () => Credential,
  refresh: (stale: Credential) => Promise<Credential>,
) {
  let flight: Promise<Credential> | undefined;

  return createHttpInterceptor(async (request, next) => {
    const authorize = (credential: Credential) => {
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${credential.accessToken}`);
      return { ...request, headers };
    };

    const used = read();
    const response = await next(authorize(used));
    const body = response.body;
    if (
      response.status !== 401 ||
      typeof body !== "object" ||
      body === null ||
      !("code" in body) ||
      body.code !== "expired_token"
    ) {
      return response;
    }

    const current = read();
    if (current.accessToken !== used.accessToken)
      return next(authorize(current));

    flight ??= refresh(used).finally(() => {
      flight = undefined;
    });
    const refreshed = await flight;
    return next(authorize(refreshed));
  });
}

let credential: Credential = { accessToken: "v1" };
const client = createClient(
  withEndpoint("https://billing.example.test"),
  withHTTPHandle(async (input, init) => {
    const auth = new Request(input, init).headers.get("authorization");
    if (auth === "Bearer v1")
      return Response.json({ code: "expired_token" }, { status: 401 });
    return Response.json({ total: 42 }, { status: 200 });
  }),
  withInterceptors(
    refreshingBearer(
      () => credential,
      async () => {
        credential = { accessToken: "v2" };
        return credential;
      },
    ),
  ),
);

const command = getInvoice();
const outcome = await client.execute(command);
const [error, invoice] = outcome;

function reportInvoice(result: typeof outcome) {
  const [fault, body] = result;
  if (fault) {
    console.error(fault.code);
    return;
  }
  console.log(body.total);
}

reportInvoice(outcome);
// #endregion
