import { expectTypeOf } from 'vitest'
import type { WEB_SOCKET_COMMAND } from '../client/command'
import { COMMAND_TYPE } from '../client/command'
// @ts-expect-error WebSocketCommandBuilder was renamed to WebSocketEndpoint
import type { WebSocketCommandBuilder } from './web_socket'
// @ts-expect-error withWebSocketOnInvalidEvent was removed
import { withWebSocketOnInvalidEvent } from '../index'

import {
  defineWebSocket,
  type WebSocketEndpoint,
  type WebSocketExecuteOptions,
  type WebSocketIncomingData,
  type WebSocketOutgoingData,
  type WebSocketSession,
} from './web_socket'
import { struct, type AnyStruct } from '../struct'

const Incoming = struct.object({ text: struct.string(), type: struct.literal('message') })
const Outgoing = struct.object({ text: struct.string().alias('message_text'), type: struct.literal('message') })

const useChat = defineWebSocket({
  path: '/ws',
  maxIncomingQueueSize: 16,
  incoming: Incoming,
  outgoing: Outgoing,
})

// @ts-expect-error maxIncomingQueueSize is required for every endpoint owner
defineWebSocket({ path: '/ws', incoming: struct.string() })

function takesWebSocketEndpoint<TInput extends AnyStruct | undefined, TIncoming extends AnyStruct, TOutgoing extends AnyStruct | undefined>(
  endpoint: WebSocketEndpoint<TInput, TIncoming, TOutgoing>,
): WebSocketEndpoint<TInput, TIncoming, TOutgoing> {
  return endpoint
}

expectTypeOf(takesWebSocketEndpoint(useChat)).toEqualTypeOf<typeof useChat>()
void (undefined as unknown as WebSocketCommandBuilder<undefined, AnyStruct, undefined>)
void withWebSocketOnInvalidEvent

const command = useChat()
expectTypeOf(command[COMMAND_TYPE]).toEqualTypeOf<typeof WEB_SOCKET_COMMAND>()
expectTypeOf(command.endpoint.path).toEqualTypeOf<string>()
expectTypeOf(command.endpoint.maxIncomingQueueSize).toEqualTypeOf<number>()
expectTypeOf<WebSocketIncomingData<typeof Incoming>>().toEqualTypeOf<{ text: string; type: 'message' }>()
expectTypeOf<WebSocketOutgoingData<typeof Outgoing>>().toEqualTypeOf<{ text: string; type: 'message' }>()
expectTypeOf<WebSocketOutgoingData<undefined>>().toEqualTypeOf<never>()

async function assertAsyncDisposableWebSocketSession(value: WebSocketSession): Promise<void> {
  const disposable: AsyncDisposable = value
  const result: PromiseLike<void> = value[Symbol.asyncDispose]()
  void disposable
  void result

  await using ownedSession = value
  void ownedSession
}
void assertAsyncDisposableWebSocketSession

const options: WebSocketExecuteOptions = {
  beforeConnect({ attempt, signal }) {
    expectTypeOf(attempt).toEqualTypeOf<number>()
    expectTypeOf(signal).toEqualTypeOf<AbortSignal>()
  },
}
void options

const removedQueueOption: WebSocketExecuteOptions = {
  // @ts-expect-error execute-level queue policy was removed
  queue: { maxSize: 1 },
}
void removedQueueOption

defineWebSocket({
  incoming: struct.object({ ok: struct.boolean(), type: struct.literal('event') }),
  maxIncomingQueueSize: 1,
  path: '/ws',
  // @ts-expect-error incoming normalizers were removed
  normalizeIncoming: () => undefined,
})

defineWebSocket({
  incoming: struct.object({ ok: struct.boolean(), type: struct.literal('event') }),
  maxIncomingQueueSize: 1,
  outgoing: struct.object({ method: struct.literal('ping') }),
  path: '/ws',
  // @ts-expect-error outgoing normalizers were removed
  normalizeOutgoing: () => ({ method: 'ping' }),
})

export type Cases = true
