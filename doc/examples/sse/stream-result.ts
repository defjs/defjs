// #region example
import type {
  EventStreamHandle,
  EventStreamOpenInfo,
  Fault,
} from "@defjs/core";

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined];

const result: StreamResult<string> | undefined = undefined;
void result;
// #endregion
