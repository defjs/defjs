import { defineRequest } from "../http";
import type { HttpRequest } from "../internal/http_request";
import { struct } from "../struct";
import type { ClientWebSocketOptions } from "./config";
import type {
  Client,
  ClientConfig,
  DerivableClient,
  ClientOptions,
  QuerySerializer,
} from "./index";

// @ts-expect-error withWebSocketQueue was removed; endpoint definitions own queue limits
import { withWebSocketQueue } from "./index";

// @ts-expect-error withQueryParamsSerializer was replaced by withQuerySerializer
import { withQueryParamsSerializer } from "./index";

// @ts-expect-error QueryParamsSerializer was replaced by QuerySerializer
import type { QueryParamsSerializer } from "./index";

import type { CLIENT, RequestOptions } from "./client";
import {
  createClient,
  withCredentials,
  withEndpoint,
  withHTTPHandle,
  withQuerySerializer,
  withSSEHandle,
  withSSEOnInvalidEvent,
  withWebSocketBeforeConnect,
  withWebSocketHandle,
  withWebSocketHeartbeat,
  withWebSocketProtocols,
  withWebSocketReconnect,
  withXSRF,
} from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

declare const heartbeatConfig: ClientWebSocketOptions;
const heartbeatPayload = heartbeatConfig.heartbeat?.message?.();
type HeartbeatPayload = Expect<Equal<typeof heartbeatPayload, unknown>>;

const serializer: QuerySerializer = (query) => {
  void query["page"];
  return "ok";
};
type SerializerCases = Expect<
  Equal<QuerySerializer, (query: { [key: string]: unknown }) => string>
>;
type SerializerArity = Expect<Equal<Parameters<QuerySerializer>["length"], 1>>;
type QueryOptionCases = Expect<
  Equal<ClientOptions["querySerializer"], QuerySerializer | undefined>
>;
type QueryConfigCases = Expect<
  Equal<ClientConfig["querySerializer"], QuerySerializer | undefined>
>;

// @ts-expect-error queryParamsSerializer was replaced by querySerializer
type RemovedQueryField = ClientOptions["queryParamsSerializer"];

type XSRFTokenProvider = (context: {
  request: HttpRequest;
}) => string | null | undefined;
type XSRFTokenProviderContext = Parameters<XSRFTokenProvider>[0];

const xsrfTokenProvider: XSRFTokenProvider = ({
  request,
}: XSRFTokenProviderContext) => {
  void request;
  return "token";
};
type XsrfTokenProviderCases = Expect<
  Equal<
    typeof xsrfTokenProvider,
    (context: XSRFTokenProviderContext) => string | null | undefined
  >
>;

const customFetch = (_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    }),
  );

declare const NodeWebSocket: {
  readonly OPEN: 1;
  new (
    address: string | URL,
    protocols?: string | string[],
  ): Omit<WebSocket, "dispatchEvent">;
};

const client = createClient(
  withEndpoint("https://api.example.com"),
  withCredentials(true),
  withHTTPHandle(customFetch),
  withSSEHandle(customFetch),
  withWebSocketHandle(NodeWebSocket),
  withWebSocketBeforeConnect(({ attempt, signal }) => {
    void attempt;
    void signal;
    return Promise.resolve();
  }),
  withWebSocketProtocols(["json"]),
  withWebSocketHeartbeat({
    intervalMs: 1_000,
    timeoutMs: 5_000,
  }),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 1_000,
  }),
  withQuerySerializer(serializer),
  withXSRF({
    cookieName: "CUSTOM-XSRF-TOKEN",
    headerName: "X-CUSTOM-XSRF-TOKEN",
    tokenProvider: xsrfTokenProvider,
  }),
);

type ClientCases = Expect<Equal<typeof client, DerivableClient>>;
type OptionalCallOptions = Expect<
  Equal<Client[typeof CLIENT]["options"], RequestOptions | undefined>
>;
const derivedClient: Client = client();
// @ts-expect-error A derived client is not callable.
derivedClient();
type ClientAsyncDisposeCase = Expect<
  typeof Symbol.asyncDispose extends keyof Client ? false : true
>;

const useGetUser = defineRequest({
  method: "GET",
  path: "/users",
  output: struct.object({ name: struct.string() }),
});

void useGetUser(client({ onUploadProgress: () => undefined }));

createClient(withWebSocketHandle(NodeWebSocket));

const invalidReasons: string[] = [];
createClient(
  withSSEOnInvalidEvent(({ reason }) => invalidReasons.push(reason)),
);

const options = {
  endpoints: ["https://api.example.com"],
  http: {
    handle: customFetch,
  },
  interceptors: [],
  querySerializer: serializer,
  sse: {
    handle: customFetch,
  },
  webSocket: {
    handle: NodeWebSocket,
    beforeConnect: ({ attempt, signal }) => {
      void attempt;
      void signal;
      return Promise.resolve();
    },
    heartbeat: {
      intervalMs: 1_000,
      timeoutMs: 5_000,
    },
    protocols: ["json"],
    reconnect: {
      attempts: 3,
      delayMs: 1_000,
    },
  },
  xsrf: {
    cookieName: "CUSTOM-XSRF-TOKEN",
    headerName: "X-CUSTOM-XSRF-TOKEN",
    tokenProvider: xsrfTokenProvider,
  },
  withCredentials: true,
} satisfies ClientOptions;

type OptionsCases = Expect<
  Equal<ClientOptions["endpoints"], readonly string[]>
>;
void options;

type XsrfOptionsCases = Expect<
  Equal<
    ClientOptions["xsrf"],
    | {
        cookieName?: string;
        headerName?: string;
        tokenProvider?: XSRFTokenProvider;
      }
    | undefined
  >
>;
type XsrfConfigCases = Expect<
  Equal<
    ClientConfig["xsrf"],
    | {
        cookieName: string;
        headerName: string;
        tokenProvider?: XSRFTokenProvider;
      }
    | undefined
  >
>;

// @ts-expect-error withEndpoint expects a string
createClient(withEndpoint(1));

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error serializer must return a string
  withQuerySerializer(() => 1),
);

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error the serializer argument is the encoded query object, not URLSearchParams
  withQuerySerializer((params: URLSearchParams) => params.toString()),
);

// @ts-expect-error withHTTPHandle expects a fetch implementation
createClient(withEndpoint("https://api.example.com"), withHTTPHandle(1));

// @ts-expect-error withSSEHandle expects a fetch implementation
createClient(withEndpoint("https://api.example.com"), withSSEHandle(1));

// @ts-expect-error withWebSocketHandle expects a WebSocket constructor
createClient(withEndpoint("https://api.example.com"), withWebSocketHandle(1));

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withWebSocketProtocols expects a string array
  withWebSocketProtocols([1]),
);

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withWebSocketHeartbeat requires an interval
  withWebSocketHeartbeat({ timeoutMs: 1 }),
);

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withWebSocketBeforeConnect expects a function
  withWebSocketBeforeConnect("not-a-function"),
);

void withWebSocketQueue;
void withQueryParamsSerializer;
const removedSerializer: QueryParamsSerializer = undefined;
const removedField: RemovedQueryField = undefined;
void removedSerializer;
void removedField;

const removedQueue: ClientWebSocketOptions = {
  // @ts-expect-error client-level WebSocket queue configuration was removed
  queue: { maxSize: 1 },
};
void removedQueue;

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withWebSocketReconnect attempts must be numeric
  withWebSocketReconnect({ attempts: "3" }),
);

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withXSRF cookieName must be a string
  withXSRF({ cookieName: 1 }),
);

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withXSRF tokenProvider must be synchronous and return a token or nullish value
  withXSRF({ tokenProvider: () => Promise.resolve("token") }),
);

export type Cases = [
  HeartbeatPayload,
  ClientAsyncDisposeCase,
  ClientCases,
  OptionalCallOptions,
  OptionsCases,
  QueryConfigCases,
  QueryOptionCases,
  SerializerArity,
  SerializerCases,
  XsrfTokenProviderCases,
  XsrfOptionsCases,
  XsrfConfigCases,
];
