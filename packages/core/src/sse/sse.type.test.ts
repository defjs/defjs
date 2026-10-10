import { expectTypeOf } from 'vitest'
import type { EVENT_STREAM_COMMAND } from '../client/command'
import { COMMAND_TYPE } from '../client/command'
import type { ClientSSEOptions } from '../client/config'

// @ts-expect-error client-level SSE queue configuration was removed.
import { withSSEQueue } from '../index'

// @ts-expect-error low-level transport callback context is not part of the public barrel.
import type { FetchEventStreamErrorContext } from '../index'

// @ts-expect-error low-level transport options are not part of the public barrel.
import type { FetchEventStreamOptions } from '../index'

// @ts-expect-error EventStreamCommandBuilder was renamed to EventStreamEndpoint
import type { EventStreamCommandBuilder } from '../index'

import {
  createClient,
  defineEventStream,
  struct,
  type AnyStruct,
  type EventStreamData,
  type EventStreamEndpoint,
  type EventStreamFaultCode,
  type EventStructs,
  type Fault,
} from '../index'
import type { EventStreamHandle, EventStreamOpenInfo } from './transport/event_stream'

// @ts-expect-error SSE definitions require an endpoint-owned queue limit.
defineEventStream({ maxBufferSize: 1024, path: '/missing-queue-limit', events: { message: struct.string() } })

// @ts-expect-error SSE definitions require an endpoint-owned parser limit.
defineEventStream({ maxQueueSize: 16, path: '/missing-buffer-limit', events: { message: struct.string() } })

void withSSEQueue
void (undefined as unknown as FetchEventStreamOptions)
void (undefined as unknown as FetchEventStreamErrorContext)

const removedClientLimit: ClientSSEOptions = {
  // @ts-expect-error maxBufferSize belongs to each event-stream definition.
  maxBufferSize: 1024,
}
void removedClientLimit

const useEvents = defineEventStream({
  maxBufferSize: 1024,
  maxQueueSize: 16,
  path: '/events',
  events: { message: struct.object({ text: struct.string() }) },
})

const chatStream = defineEventStream({
  builder: (input) => input,
  maxBufferSize: 1024,
  maxQueueSize: 16,
  method: 'POST',
  path: '/v1/chat/completions',
  input: struct.object({
    body: struct.object({
      model: struct.string(),
      stream: struct.boolean(),
    }),
  }),
  events: { message: struct.string() },
})
void chatStream

function takesEventStreamEndpoint<TInput extends AnyStruct | undefined, TEvents extends EventStructs>(
  endpoint: EventStreamEndpoint<TInput, TEvents>,
): EventStreamEndpoint<TInput, TEvents> {
  return endpoint
}

expectTypeOf(takesEventStreamEndpoint(useEvents)).toEqualTypeOf<typeof useEvents>()

const command = useEvents()
expectTypeOf(command[COMMAND_TYPE]).toEqualTypeOf<typeof EVENT_STREAM_COMMAND>()
expectTypeOf(command.endpoint.path).toEqualTypeOf<string>()

void (undefined as unknown as EventStreamCommandBuilder<undefined, EventStructs>)

const catalogEventStructs = {
  'price-updated': struct.object({ priceCents: struct.number(), sku: struct.string() }),
  'product-retired': struct.object({ reason: struct.string(), sku: struct.string() }),
} satisfies EventStructs

expectTypeOf<EventStreamData<typeof catalogEventStructs>['event']>().toEqualTypeOf<'price-updated' | 'product-retired'>()

const catalogEvents = defineEventStream({
  events: catalogEventStructs,
  maxBufferSize: 1024,
  maxQueueSize: 16,
  path: '/catalog/events',
})

async function assertNamedEventNarrowing(): Promise<void> {
  const [error, stream] = await createClient().execute(catalogEvents())
  if (error) return

  for await (const event of stream) {
    // @ts-expect-error Variant-only fields require event-name narrowing.
    void event.data.priceCents

    switch (event.event) {
      case 'price-updated':
        expectTypeOf(event.data).toEqualTypeOf<{ priceCents: number; sku: string }>()
        expectTypeOf(event.data.priceCents).toEqualTypeOf<number>()
        // @ts-expect-error Retirement-only fields remain unavailable in this branch.
        void event.data.reason
        break
      case 'product-retired':
        expectTypeOf(event.data).toEqualTypeOf<{ reason: string; sku: string }>()
        expectTypeOf(event.data.reason).toEqualTypeOf<string>()
        // @ts-expect-error Price-only fields remain unavailable in this branch.
        void event.data.priceCents
        break
      default: {
        const exhaustive: never = event
        void exhaustive
      }
    }
  }
}

void assertNamedEventNarrowing

async function assertRequiredStartupOpenInfo(): Promise<void> {
  const [error, stream, open] = await createClient().execute(useEvents())
  if (error) return

  expectTypeOf(open).toEqualTypeOf<EventStreamOpenInfo>()
  expectTypeOf(open.response.status).toEqualTypeOf<number>()
  expectTypeOf(open.url).toEqualTypeOf<string>()
  stream.close()
}

void assertRequiredStartupOpenInfo

async function assertAsyncDisposableEventStream(handle: EventStreamHandle<unknown>): Promise<void> {
  const disposable: AsyncDisposable = handle
  void disposable

  await using ownedStream = handle
  void ownedStream
}

void assertAsyncDisposableEventStream

const closeFaultCode: EventStreamFaultCode = 'CAP_QUEUE_OVERFLOW'
void closeFaultCode

type CatalogEvent = EventStreamData<typeof catalogEventStructs>
declare const catalogEvent: CatalogEvent
// @ts-expect-error retry is parser control state, not public event data.
void catalogEvent.retry
// @ts-expect-error Undeclared events are dropped when no default Struct exists.
const undeclaredCatalogEvent: CatalogEvent = { data: 'raw', event: 'inventory-reset' }
void undeclaredCatalogEvent

const defaultEventStructs = { default: struct.string() } satisfies EventStructs
expectTypeOf<EventStreamData<typeof defaultEventStructs>['event']>().toEqualTypeOf<string>()
expectTypeOf<EventStreamData<typeof defaultEventStructs>['data']>().toEqualTypeOf<string>()

const mixedEventStructs = {
  default: struct.string(),
  message: struct.object({ text: struct.string() }),
} satisfies EventStructs
expectTypeOf<EventStreamData<typeof mixedEventStructs>['event']>().toEqualTypeOf<string>()
expectTypeOf<EventStreamData<typeof mixedEventStructs>['data']>().toEqualTypeOf<string | { text: string }>()

const alphaStruct = struct.object({ alpha: struct.string() })
const betaStruct = struct.object({ beta: struct.number() })
type DistributedEvent = EventStreamData<{ alpha: typeof alphaStruct } | { beta: typeof betaStruct }>
expectTypeOf<DistributedEvent['event']>().toEqualTypeOf<'alpha' | 'beta'>()

function assertDistributedEventNarrowing(event: DistributedEvent): void {
  switch (event.event) {
    case 'alpha':
      expectTypeOf(event.data.alpha).toEqualTypeOf<string>()
      break
    case 'beta':
      expectTypeOf(event.data.beta).toEqualTypeOf<number>()
      break
  }
}
void assertDistributedEventNarrowing

const numericEventStructs = { 404: struct.string() } satisfies EventStructs
expectTypeOf<EventStreamData<typeof numericEventStructs>['event']>().toEqualTypeOf<'404'>()
expectTypeOf<EventStreamData<typeof numericEventStructs>['data']>().toEqualTypeOf<string>()

const prototypeEventStructs = { ['__proto__']: struct.number() } satisfies EventStructs
expectTypeOf<EventStreamData<typeof prototypeEventStructs>['event']>().toEqualTypeOf<'__proto__'>()
expectTypeOf<EventStreamData<typeof prototypeEventStructs>['data']>().toEqualTypeOf<number>()

const SseError = struct.object({ code: struct.string() })

const streamWithError = defineEventStream({
  error: SseError,
  events: { message: struct.string() },
  maxBufferSize: 1024,
  maxQueueSize: 16,
  path: '/events',
})

async function assertDeclaredSseStartupFault(): Promise<void> {
  const [error] = await createClient().execute(streamWithError())
  if (!error) {
    return
  }

  expectTypeOf(error).toEqualTypeOf<Fault<typeof SseError>>()
  if (error.code === 'HTTP_STATUS') {
    expectTypeOf(error.data.code).toEqualTypeOf<string>()
  }
}
void assertDeclaredSseStartupFault

async function assertUndeclaredSseStartupFault(): Promise<void> {
  const [error] = await createClient().execute(useEvents())
  if (!error) {
    return
  }

  expectTypeOf(error).toEqualTypeOf<Fault<undefined>>()
}
void assertUndeclaredSseStartupFault

export type Cases = true
