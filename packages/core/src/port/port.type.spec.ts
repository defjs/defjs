import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
  withWebSocketHandle,
  type ClientOption,
  type FetchHandle,
  type WebSocketHandleConstructor,
} from "../index";
import {
  attachPortHost,
  createPortHTTPHandle,
  createPortSSEHandle,
  createPortWebSocketHandle,
  withPortTransport,
  type PortClientOptions,
  type PortEndpoint,
  type PortHostHandle,
  type PortHostOptions,
  type PortLike,
  type PortWebSocketConstructor,
  type PortWebSocketHandle,
  type PortWebSocketHandleConstructor,
  type PortWireMode,
} from "./index";
import {
  fromWebExtPort,
  type WebExtEvent,
  type WebExtPort,
  type WebExtPortOptions,
} from "./webext/index";

const mode: PortWireMode = "json";
const channel = new MessageChannel();

const option: ClientOption = withPortTransport(channel.port1, {
  mode: "structured",
  chunkSize: 65_536,
  creditWindow: 4,
});
const httpHandle: FetchHandle = createPortHTTPHandle(channel.port1);
const sseHandle: FetchHandle = createPortSSEHandle(channel.port1);
const wsHandle: PortWebSocketHandleConstructor = createPortWebSocketHandle(
  channel.port1,
);
const coreWsHandle: WebSocketHandleConstructor = wsHandle;
const portWsCtor: PortWebSocketConstructor = wsHandle;
const portWsInstance: PortWebSocketHandle = new wsHandle(
  "wss://api.example.com/chat",
);
portWsInstance.binaryType = "arraybuffer";

const client = createClient(
  withEndpoint("https://api.example.com"),
  option,
  withHTTPHandle(httpHandle),
  withSSEHandle(sseHandle),
  withWebSocketHandle(coreWsHandle),
);

const getPing = defineRequest({
  method: "GET",
  path: "/ping",
  output: struct.string(),
});

const streamEvents = defineEventStream({
  path: "/events",
  events: { tick: struct.string() },
});

const connectChat = defineWebSocket({
  path: "/chat",
  incoming: struct.string(),
  outgoing: struct.string(),
});

void getPing(client);
void streamEvents(client);
void connectChat(client);

const fakeWebExtEvent = <T>(): WebExtEvent<T> => ({
  addListener: () => undefined,
  removeListener: () => undefined,
});

const rawExtPort: WebExtPort = {
  name: "defjs",
  postMessage: () => undefined,
  onMessage: fakeWebExtEvent<(message: unknown) => void>(),
  onDisconnect: fakeWebExtEvent<() => void>(),
};

const webextOpts: WebExtPortOptions = { mode };
const adapted: PortEndpoint = fromWebExtPort(() => rawExtPort, webextOpts);
const portLike: PortLike = adapted;
const clientOpts: PortClientOptions = { mode: "json" };
void withPortTransport(portLike, clientOpts);

const hostOpts: PortHostOptions = {
  allowedOrigins: ["https://api.example.com"],
  WebSocket: portWsCtor,
  allowRequest: ({ transport, url, method, headers }) =>
    transport === "http" &&
    url.protocol === "https:" &&
    method === "GET" &&
    headers.has("authorization"),
};

const host: PortHostHandle = attachPortHost(channel.port2, hostOpts);
host.close();
host[Symbol.dispose]();

// @ts-expect-error PortWireMode rejects unsupported modes
const badMode: PortWireMode = "binary";

// @ts-expect-error fromWebExtPort rejects unrelated objects without onMessage/onDisconnect
fromWebExtPort({ postMessage: () => undefined });
