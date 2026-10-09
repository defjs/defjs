import type { DefaultTheme } from 'vitepress'

type ApiItem = {
  text: string
  id: string
}

type ApiGroup = {
  title: string
  path: string
  items: ApiItem[]
}

type ApiPackage = {
  title: string
  collapsed?: boolean
  groups?: ApiGroup[]
  path?: string
  items?: ApiItem[]
}

const fn = (name: string): ApiItem => ({ text: `${name}()`, id: name })
const t = (name: string): ApiItem => ({ text: name, id: name })
const member = (name: string): ApiItem => ({ text: `${name}()`, id: name })

const coreGroups: ApiGroup[] = [
  {
    title: 'Client',
    path: '/api/client',
    items: [
      fn('createClient'),
      fn('withEndpoint'),
      fn('withInterceptors'),
      fn('withQuerySerializer'),
      fn('withHTTPHandle'),
      fn('withSSEHandle'),
      fn('withWebSocketHandle'),
      fn('withCredentials'),
      fn('withXSRF'),
      fn('withSSEReconnect'),
      fn('withSSEOnInvalidEvent'),
      fn('withWebSocketBeforeConnect'),
      fn('withWebSocketProtocols'),
      fn('withWebSocketHeartbeat'),
      fn('withWebSocketReconnect'),
      t('Client'),
      t('ClientOption'),
      t('ClientOptions'),
      t('ClientConfig'),
      t('ClientSSEOptions'),
      t('ClientSSEConfig'),
      t('ClientWebSocketOptions'),
      t('QuerySerializer'),
      t('WebSocketHandle'),
      t('WebSocketHandleConstructor'),
    ],
  },
  {
    title: 'HTTP',
    path: '/api/http',
    items: [
      fn('defineRequest'),
      fn('executeHttpCommand'),
      fn('fetchHandler'),
      fn('makeResponse'),
      t('RequestDefinition'),
      t('ResponseDeclaration'),
      t('RequestEndpoint'),
      t('BuilderInput'),
      t('HttpRequestShape'),
      t('HttpCommand'),
      t('HttpExecuteOptions'),
      t('UseRequestConfig'),
      t('HttpAwaitResult'),
      t('RequestSuccessData'),
      t('RequestErrorData'),
      t('HttpRequest'),
      t('HttpMeta'),
      t('DecodedResponse'),
      t('HttpResponse'),
      t('HttpResponseType'),
      t('HttpProgressEvent'),
      t('HttpProgressFn'),
      t('MakeResponseOptions'),
    ],
  },
  {
    title: 'Struct',
    path: '/api/struct',
    items: [
      t('struct'),
      { text: 'struct.any()', id: 'struct' },
      { text: 'struct.array()', id: 'struct' },
      { text: 'struct.arrayBuffer()', id: 'struct' },
      { text: 'struct.bigint()', id: 'struct' },
      { text: 'struct.blob()', id: 'struct' },
      { text: 'struct.boolean()', id: 'struct' },
      { text: 'struct.date()', id: 'struct' },
      { text: 'struct.discriminatedUnion()', id: 'struct' },
      { text: 'struct.enum()', id: 'struct' },
      { text: 'struct.file()', id: 'struct' },
      { text: 'struct.formData()', id: 'struct' },
      { text: 'struct.intersection()', id: 'struct' },
      { text: 'struct.literal()', id: 'struct' },
      { text: 'struct.null()', id: 'struct' },
      { text: 'struct.number()', id: 'struct' },
      { text: 'struct.object()', id: 'struct' },
      { text: 'struct.or()', id: 'struct' },
      member('struct.parse'),
      { text: 'struct.record()', id: 'struct' },
      { text: 'struct.string()', id: 'struct' },
      { text: 'struct.tuple()', id: 'struct' },
      { text: 'struct.unknown()', id: 'struct' },
      { text: 'struct.urlencoded()', id: 'struct' },
      t('Infer'),
      t('StructInput'),
      t('AnyStruct'),
      t('Struct'),
      t('StructLike'),
      t('StructMethods'),
      t('ObjectStruct'),
      t('ParseResult'),
      t('ErrorMap'),
      t('StructError'),
      t('StructIssue'),
      t('FormattedStructError'),
      t('FlattenedStructError'),
    ],
  },
  {
    title: 'Errors',
    path: '/api/errors',
    items: [
      t('FaultCode'),
      t('FaultClass'),
      t('Fault'),
      { text: 'FaultOf', id: 'Fault' },
      t('HttpStatusFault'),
      { text: 'HttpStatusFaultOf', id: 'HttpStatusFault' },
      t('DecodeFault'),
      t('PreflightFault'),
      t('AnyFault'),
      fn('createHttpStatusFault'),
      fn('createUndecodedHttpStatusFault'),
      fn('createDecodeFault'),
      fn('createNetworkFault'),
      fn('createPreflightFault'),
      t('ERR_ABORTED'),
      t('ERR_TIMEOUT'),
    ],
  },
  {
    title: 'Interceptors',
    path: '/api/interceptors',
    items: [
      fn('createHttpInterceptor'),
      fn('createSSEInterceptor'),
      fn('createWebSocketInterceptor'),
      fn('basicAuthHttpInterceptor'),
      fn('basicAuthSSEInterceptor'),
      t('Interceptor'),
      { text: 'InterceptorFn', id: 'createHttpInterceptor' },
      t('HttpInterceptor'),
      { text: 'HttpInterceptorNext', id: 'createHttpInterceptor' },
      t('SSEInterceptor'),
      { text: 'SSEInterceptorFn', id: 'createSSEInterceptor' },
      { text: 'SSEHandler', id: 'createSSEInterceptor' },
      t('WebSocketInterceptor'),
      { text: 'WebSocketInterceptorFn', id: 'createWebSocketInterceptor' },
      { text: 'WebSocketHandler', id: 'createWebSocketInterceptor' },
      { text: 'WebSocketSessionLike', id: 'createWebSocketInterceptor' },
      t('BasicAuthInterceptorOptions'),
    ],
  },
  {
    title: 'SSE',
    path: '/api/sse',
    items: [
      fn('defineEventStream'),
      fn('executeEventStreamCommand'),
      t('EventStreamDefinition'),
      t('EventStreamEndpoint'),
      t('EventStreamRequestShape'),
      t('EventStreamCommand'),
      t('EventStreamExecuteOptions'),
      t('StreamAwaitResult'),
      t('EventStreamHandle'),
      t('EventStreamOpenInfo'),
      t('EventStreamCloseInfo'),
      { text: 'EventStreamErrorCode', id: 'EventStreamCloseInfo' },
      t('EventStructs'),
      t('EventStreamData'),
    ],
  },
  {
    title: 'WebSocket',
    path: '/api/web-socket',
    items: [
      fn('defineWebSocket'),
      fn('executeWebSocketCommand'),
      t('WebSocketDefinition'),
      t('WebSocketEndpoint'),
      t('WebSocketRequestShape'),
      t('WebSocketCommand'),
      t('WebSocketExecuteOptions'),
      t('UseWebSocketConfig'),
      t('SocketAwaitResult'),
      t('WebSocketSession'),
      t('WebSocketState'),
      t('WebSocketConnectionInfo'),
      t('WebSocketCloseInfo'),
      t('ManualSocketCloseReason'),
      t('WebSocketHeartbeatConfig'),
      t('WebSocketIncomingData'),
      t('WebSocketOutgoingData'),
      t('SocketLifecycleOutcome'),
    ],
  },
]

export const apiPackages: ApiPackage[] = [
  {
    title: '@defjs/core',
    groups: coreGroups,
  },
  {
    title: '@defjs/vue',
    path: '/api/vue',
    items: [fn('createClientPlugin'), fn('injectClient'), t('HTTP_CLIENT')],
  },
  {
    title: '@defjs/react',
    path: '/api/react',
    items: [t('ClientProvider'), fn('useClient'), t('ClientProviderProps')],
  },
  {
    title: '@defjs/opentelemetry-server',
    path: '/api/opentelemetry-server',
    items: [
      fn('withOpenTelemetryServer'),
      t('OpenTelemetryServerOptions'),
      t('OpenTelemetryServerTransportOptions'),
      t('OpenTelemetryServerHttpOptions'),
      t('OpenTelemetryServerSSEOptions'),
      t('OpenTelemetryServerWebSocketOptions'),
    ],
  },
]

const symbolLink = (prefix: string, path: string, item: ApiItem): DefaultTheme.SidebarItem => ({
  text: item.text,
  link: `${prefix}${path}#${item.id}`,
})

export const createApiSidebar = (prefix: string, overview: string): DefaultTheme.SidebarItem[] => [
  { text: overview, link: `${prefix}/api/` },
  ...apiPackages.map((pkg) => {
    if (pkg.groups) {
      return {
        text: pkg.title,
        collapsed: false,
        items: pkg.groups.flatMap((group) => group.items.map((item) => symbolLink(prefix, group.path, item))),
      }
    }

    return {
      text: pkg.title,
      collapsed: false,
      items: (pkg.items ?? []).map((item) => symbolLink(prefix, pkg.path ?? '/api/', item)),
    }
  }),
]
