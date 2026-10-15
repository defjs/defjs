import { expectTypeOf } from 'vitest'
import { createClient, defineWebSocket, struct, type Infer, type StructInput, type WebSocketExecuteOptions } from '../index'

const Incoming = struct.discriminatedUnion('type', [
  struct.object({ text: struct.string(), type: struct.literal('said') }),
  struct.object({ type: struct.literal('pong') }),
])
const Outgoing = struct.object({
  text: struct.string().alias('message_text'),
  type: struct.literal('say'),
})

const chat = defineWebSocket({
  incoming: Incoming,
  maxIncomingQueueSize: 1,
  outgoing: Outgoing,
  path: '/ws',
})

const listen = defineWebSocket({
  incoming: Incoming,
  maxIncomingQueueSize: 1,
  path: '/ws',
})

async function assertReceiveAndSend(): Promise<void> {
  const [error, socket] = await createClient().execute(chat())
  if (error || !socket) {
    return
  }

  expectTypeOf(socket.send).parameter(0).toEqualTypeOf<StructInput<typeof Outgoing>>()
  socket.send({ text: 'hi', type: 'say' })

  for await (const message of socket.receive) {
    expectTypeOf(message).toEqualTypeOf<Infer<typeof Incoming>>()
    if (message.type === 'said') {
      expectTypeOf(message.text).toEqualTypeOf<string>()
    }
  }
}
void assertReceiveAndSend

async function assertSendWithoutOutgoingIsRejected(): Promise<void> {
  const [error, socket] = await createClient().execute(listen())
  if (error || !socket) {
    return
  }

  // @ts-expect-error a socket with no outgoing struct cannot send
  socket.send({ text: 'hi', type: 'say' })
}
void assertSendWithoutOutgoingIsRejected

void createClient().execute(chat(), {
  heartbeat: {
    intervalMs: 1_000,
    isAck(message) {
      expectTypeOf(message).toEqualTypeOf<Infer<typeof Incoming>>()
      return message.type === 'pong'
    },
    message: () => ({ text: 'ping', type: 'say' as const }),
  },
})

const mismatchedHeartbeat: WebSocketExecuteOptions<Infer<typeof Incoming>, StructInput<typeof Outgoing>> = {
  heartbeat: {
    intervalMs: 1_000,
    // @ts-expect-error heartbeat messages must match the outgoing struct input
    message: () => ({ type: 'say' }),
  },
}
void mismatchedHeartbeat

const noOutgoingHeartbeat: WebSocketExecuteOptions<Infer<typeof Incoming>, never> = {
  heartbeat: {
    intervalMs: 1_000,
    // @ts-expect-error heartbeat cannot send when the endpoint has no outgoing struct
    message: () => ({ text: 'ping', type: 'say' as const }),
  },
}
void noOutgoingHeartbeat

export type Cases = true
