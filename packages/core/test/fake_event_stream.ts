import { makeResponse } from "../src/http/http_response";
import type {
  EventStreamCloseInfo,
  EventStreamHandle,
} from "../src/sse/transport/event_stream";

/** An open stream that carries no events and never closes by itself, for a test that only passes a handle along. */
export function fakeEventStream(): EventStreamHandle<unknown> {
  const closed = new Promise<EventStreamCloseInfo>(() => {});
  return {
    open: {
      response: makeResponse({ status: 200 }),
      url: "https://example.test/events",
    },
    closed,
    close() {},
    [Symbol.asyncDispose]: () => Promise.resolve(),
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true, value: undefined }),
    }),
  };
}
