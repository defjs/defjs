import type { HttpRequest } from "../src/http/index.ts";
import type { AnyStruct } from "../src/struct/index.ts";
import {
  fetchEventStream,
  type EventStreamHandle,
  type FetchEventStreamOptions,
} from "../src/sse/transport/event_stream.ts";
import type { EventStreamMessage } from "../src/sse/transport/parser.ts";

/**
 * `fetchEventStream` as the transport specs read it: the stream, or a throw of the cause that ended startup.
 * The transport owns the headers of the request it gets, so the spec's request keeps its own.
 */
export async function startEventStream<
  TEvent = EventStreamMessage,
  TError extends AnyStruct | undefined = AnyStruct | undefined,
>(
  request: HttpRequest,
  options: FetchEventStreamOptions<TEvent, TError>,
): Promise<EventStreamHandle<TEvent>> {
  const [failure, stream] = await fetchEventStream(
    { ...request, headers: new Headers(request.headers) },
    options,
  );
  if (failure !== null) {
    throw failure.cause;
  }
  return stream;
}
