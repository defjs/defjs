import { expectTypeOf } from "vitest";
import type { ClientSSEOptions } from "../client/config";

// @ts-expect-error client-level SSE queue configuration was removed.
import { withSSEQueue } from "../index";

// @ts-expect-error low-level transport callback context is not part of the public barrel.
import type { FetchEventStreamErrorContext } from "../index";

// @ts-expect-error low-level transport options are not part of the public barrel.
import type { FetchEventStreamOptions } from "../index";

// @ts-expect-error EventStreamCommandBuilder was renamed to EventStreamEndpoint
import type { EventStreamCommandBuilder } from "../index";

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
  type HttpStatusFaultOf,
  withRetry,
} from "../index";
import type {
  EventStreamHandle,
  EventStreamOpenInfo,
} from "./transport/event_stream";

defineEventStream({
  path: "/default-limits",
  events: { message: struct.string() },
});

defineEventStream({
  maxBufferSize: 1024,
  path: "/custom-buffer-limit-only",
  events: { message: struct.string() },
});

defineEventStream({
  path: "/custom-queue-limit-only",
  events: { message: struct.string() },
});

function useType<T>(_probe?: T): T | undefined {
  return _probe;
}

void withSSEQueue;
useType<FetchEventStreamOptions>();
useType<FetchEventStreamErrorContext>();

const removedClientLimit: ClientSSEOptions = {
  // @ts-expect-error maxBufferSize belongs to each event-stream definition.
  maxBufferSize: 1024,
};
void removedClientLimit;

const useEvents = defineEventStream({
  path: "/events",
  events: { message: struct.object({ text: struct.string() }) },
});

const chatStream = defineEventStream({
  builder: (input) => ({ body: input }),
  method: "POST",
  path: "/v1/chat/completions",
  input: struct.object({
    model: struct.string(),
    stream: struct.boolean(),
  }),
  events: { message: struct.string() },
});
void chatStream;

function takesEventStreamEndpoint<
  Args extends unknown[],
  Event,
  TError extends AnyStruct | undefined,
>(
  endpoint: EventStreamEndpoint<Args, Event, TError>,
): EventStreamEndpoint<Args, Event, TError> {
  return endpoint;
}

expectTypeOf(takesEventStreamEndpoint(useEvents)).toEqualTypeOf<
  typeof useEvents
>();

useType<EventStreamCommandBuilder<undefined, EventStructs>>();

const catalogEventStructs = {
  "price-updated": struct.object({
    priceCents: struct.number(),
    sku: struct.string(),
  }),
  "product-retired": struct.object({
    reason: struct.string(),
    sku: struct.string(),
  }),
} satisfies EventStructs;

expectTypeOf<
  EventStreamData<typeof catalogEventStructs>["event"]
>().toEqualTypeOf<"price-updated" | "product-retired">();

const catalogEvents = defineEventStream({
  events: catalogEventStructs,
  path: "/catalog/events",
});

async function assertNamedEventNarrowing(): Promise<void> {
  const [error, stream] = await catalogEvents(createClient());
  if (error) return;

  for await (const event of stream) {
    // @ts-expect-error Variant-only fields require event-name narrowing.
    void event.data.priceCents;

    switch (event.event) {
      case "price-updated":
        expectTypeOf(event.data).toEqualTypeOf<{
          priceCents: number;
          sku: string;
        }>();
        expectTypeOf(event.data.priceCents).toEqualTypeOf<number>();
        // @ts-expect-error Retirement-only fields remain unavailable in this branch.
        void event.data.reason;
        break;
      case "product-retired":
        expectTypeOf(event.data).toEqualTypeOf<{
          reason: string;
          sku: string;
        }>();
        expectTypeOf(event.data.reason).toEqualTypeOf<string>();
        // @ts-expect-error Price-only fields remain unavailable in this branch.
        void event.data.priceCents;
        break;
      default: {
        const exhaustive: never = event;
        void exhaustive;
      }
    }
  }
}

void assertNamedEventNarrowing;

async function assertRequiredStartupOpenInfo(): Promise<void> {
  const [error, stream, open] = await useEvents(createClient());
  if (error) return;

  expectTypeOf(open).toEqualTypeOf<EventStreamOpenInfo>();
  expectTypeOf(open.response.status).toEqualTypeOf<number>();
  expectTypeOf(open.url).toEqualTypeOf<string>();
  stream.close();
}

void assertRequiredStartupOpenInfo;

async function assertAsyncDisposableEventStream(
  handle: EventStreamHandle<unknown>,
): Promise<void> {
  const disposable: AsyncDisposable = handle;
  void disposable;

  await using ownedStream = handle;
  void ownedStream;
}

void assertAsyncDisposableEventStream;

const closeFaultCode: EventStreamFaultCode = "CAP_BUFFER_EXCEEDED";
const reconnectBuildFault: EventStreamFaultCode = "REQ_BUILD_FAILED";
const reconnectOptionsFault: EventStreamFaultCode = "REQ_OPTIONS_INVALID";
void closeFaultCode;
void reconnectBuildFault;
void reconnectOptionsFault;

type CatalogEvent = EventStreamData<typeof catalogEventStructs>;
declare const catalogEvent: CatalogEvent;
// @ts-expect-error retry is parser control state, not public event data.
void catalogEvent.retry;
const undeclaredCatalogEvent: CatalogEvent = {
  // @ts-expect-error Undeclared events are dropped when no default Struct exists.
  data: "raw",
  // @ts-expect-error Undeclared events are dropped when no default Struct exists.
  event: "inventory-reset",
};
void undeclaredCatalogEvent;

const defaultEventStructs = { default: struct.string() } satisfies EventStructs;
expectTypeOf<
  EventStreamData<typeof defaultEventStructs>["event"]
>().toEqualTypeOf<string>();
expectTypeOf<
  EventStreamData<typeof defaultEventStructs>["data"]
>().toEqualTypeOf<string>();

const mixedEventStructs = {
  default: struct.string(),
  message: struct.object({ text: struct.string() }),
} satisfies EventStructs;
expectTypeOf<
  EventStreamData<typeof mixedEventStructs>["event"]
>().toEqualTypeOf<string>();
expectTypeOf<EventStreamData<typeof mixedEventStructs>["data"]>().toEqualTypeOf<
  string | { text: string }
>();

const alphaStruct = struct.object({ alpha: struct.string() });
const betaStruct = struct.object({ beta: struct.number() });
type DistributedEvent = EventStreamData<
  { alpha: typeof alphaStruct } | { beta: typeof betaStruct }
>;
expectTypeOf<DistributedEvent["event"]>().toEqualTypeOf<"alpha" | "beta">();

function assertDistributedEventNarrowing(event: DistributedEvent): void {
  switch (event.event) {
    case "alpha":
      expectTypeOf(event.data.alpha).toEqualTypeOf<string>();
      break;
    case "beta":
      expectTypeOf(event.data.beta).toEqualTypeOf<number>();
      break;
  }
}
void assertDistributedEventNarrowing;

const numericEventStructs = { 404: struct.string() } satisfies EventStructs;
expectTypeOf<
  EventStreamData<typeof numericEventStructs>["event"]
>().toEqualTypeOf<"404">();
expectTypeOf<
  EventStreamData<typeof numericEventStructs>["data"]
>().toEqualTypeOf<string>();

const prototypeEventStructs = {
  ["__proto__"]: struct.number(),
} satisfies EventStructs;
expectTypeOf<
  EventStreamData<typeof prototypeEventStructs>["event"]
>().toEqualTypeOf<"__proto__">();
expectTypeOf<
  EventStreamData<typeof prototypeEventStructs>["data"]
>().toEqualTypeOf<number>();

const SseError = struct.object({ code: struct.string() });

const streamWithError = defineEventStream({
  error: SseError,
  events: { message: struct.string() },
  path: "/events",
});

async function assertDeclaredSseStartupFault(): Promise<void> {
  const [error] = await streamWithError(createClient());
  if (!error) {
    return;
  }

  // A non-2xx handshake whose declared error body cannot be decoded is an HTTP_STATUS fault without `data`.
  expectTypeOf(error).toEqualTypeOf<
    Fault<typeof SseError> | HttpStatusFaultOf<undefined>
  >();
  if (error.code === "HTTP_STATUS") {
    expectTypeOf(error.data).toEqualTypeOf<{ code: string } | undefined>();
    if (error.data !== undefined) {
      expectTypeOf(error.data.code).toEqualTypeOf<string>();
    }
  }
}
void assertDeclaredSseStartupFault;

async function assertUndeclaredSseStartupFault(): Promise<void> {
  const [error] = await useEvents(createClient());
  if (!error) {
    return;
  }

  expectTypeOf(error).toEqualTypeOf<Fault<undefined>>();
}
void assertUndeclaredSseStartupFault;

withRetry({
  shouldRetry: (context) => {
    expectTypeOf(context.transport).toEqualTypeOf<
      "http" | "sse" | "websocket"
    >();
    expectTypeOf(context.retryable).toEqualTypeOf<boolean>();
    expectTypeOf(context.attempt).toEqualTypeOf<number>();
    if (context.transport === "sse") {
      expectTypeOf(context.method).toEqualTypeOf<string>();
      expectTypeOf(context.lastEventId).toEqualTypeOf<string>();
      expectTypeOf(context.status).toEqualTypeOf<number | undefined>();
      return context.method === "GET";
    }
    return context.retryable;
  },
});

export type Cases = true;
