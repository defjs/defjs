import { defineRequest } from "../http";
import type { HttpRequest } from "../http/http_request";
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

// @ts-expect-error withXSRF moved to @defjs/core/xsrf
import { withXSRF } from "./index";

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
  withRetry,
  withSSEHandle,
  withSSEOnInvalidEvent,
  withWebSocketBeforeConnect,
  withWebSocketHandle,
  withWebSocketHeartbeat,
  withWebSocketProtocols,
} from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

declare const heartbeatConfig: ClientWebSocketOptions;
const heartbeatPayload = heartbeatConfig.heartbeat?.message();
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

type FinalizeHeadersCases = Expect<
  Equal<
    ClientConfig["finalizeHeaders"],
    ((request: HttpRequest, headers: Headers, url: URL) => void) | undefined
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
    message: () => "ping",
    isAck: (message) => message === "pong",
    timeoutMs: 5_000,
  }),
  withRetry({
    maxRetries: 3,
    delayMs: 1_000,
  }),
  withQuerySerializer(serializer),
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
      message: () => "ping",
      isAck: (message) => message === "pong",
      timeoutMs: 5_000,
    },
    protocols: ["json"],
  },
  retry: {
    maxRetries: 3,
    delayMs: 1_000,
  },
  withCredentials: true,
} satisfies ClientOptions;

type OptionsCases = Expect<
  Equal<ClientOptions["endpoints"], readonly string[]>
>;
void options;

// @ts-expect-error xsrf moved to @defjs/core/xsrf
type RemovedXsrfField = ClientOptions["xsrf"];

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
void withXSRF;
void withQueryParamsSerializer;
const removedSerializer: QueryParamsSerializer = undefined;
const removedField: RemovedQueryField = undefined;
const removedXsrf: RemovedXsrfField = undefined;
void removedSerializer;
void removedField;
void removedXsrf;

const removedQueue: ClientWebSocketOptions = {
  // @ts-expect-error client-level WebSocket queue configuration was removed
  queue: { maxSize: 1 },
};
void removedQueue;

createClient(
  withEndpoint("https://api.example.com"),
  // @ts-expect-error withRetry maxRetries must be numeric
  withRetry({ maxRetries: "3" }),
);

// A heartbeat needs its message; an acknowledgement timeout needs the predicate that recognizes it.
withWebSocketHeartbeat({ intervalMs: 1_000, message: () => "ping" });
withWebSocketHeartbeat({
  intervalMs: 1_000,
  message: () => "ping",
  isAck: () => true,
});
// @ts-expect-error message is required
withWebSocketHeartbeat({ intervalMs: 1_000 });
// @ts-expect-error timeoutMs needs isAck
withWebSocketHeartbeat({
  intervalMs: 1_000,
  message: () => "ping",
  timeoutMs: 5_000,
});

// Retry options are shared by every transport and replace the client policy per call.
const retryRequest: RequestOptions = {
  retry: { maxRetries: 1, shouldRetry: (context) => context.retryable },
};
void retryRequest;
// @ts-expect-error the budget belongs to the client
const budgetRequest: RequestOptions = { retry: { budget: false } };
void budgetRequest;
// @ts-expect-error reconnect was replaced by retry
const reconnectRequest: RequestOptions = { reconnect: { attempts: 1 } };
void reconnectRequest;

export type Cases = [
  HeartbeatPayload,
  ClientAsyncDisposeCase,
  ClientCases,
  FinalizeHeadersCases,
  OptionalCallOptions,
  OptionsCases,
  QueryConfigCases,
  QueryOptionCases,
  SerializerArity,
  SerializerCases,
];
