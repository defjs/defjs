// #region example
import type {
  EventStreamCloseInfo,
  EventStreamHandle,
  EventStreamOpenInfo,
} from "@defjs/core";

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo;
  readonly closed: Promise<EventStreamCloseInfo>;
  close(reason?: unknown): void;
  [Symbol.asyncDispose](): PromiseLike<void>;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original assignment-based lifecycle compatibility example without replacing it by a new function
const handle = null as unknown as EventStreamHandle<string>;
const api: StreamApi<string> = handle;
void api;
// #endregion
