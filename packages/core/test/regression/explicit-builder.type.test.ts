import {
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
} from "../../src";

const Input = struct.object({
  query: struct.object({ keyword: struct.string() }),
});

// @ts-expect-error An input field named `query` does not imply query placement.
defineRequest({ method: "GET", path: "/search", input: Input });
// @ts-expect-error Optional input still needs an explicit builder.
defineRequest({ method: "GET", path: "/search", input: Input.optional() });
// @ts-expect-error A wholly optional input object still needs an explicit builder.
defineRequest({
  method: "POST",
  path: "/search",
  input: struct.object({ body: struct.string().optional() }),
});
// @ts-expect-error SSE input never supplies an implicit builder.
defineEventStream({
  path: "/events",
  input: Input,
  events: {},
  maxBufferSize: 1024,
  maxQueueSize: 4,
});
// @ts-expect-error WebSocket input never supplies an implicit builder.
defineWebSocket({
  path: "/socket",
  input: Input,
  incoming: struct.string(),
  maxIncomingQueueSize: 4,
});

defineRequest({
  method: "GET",
  path: "/search",
  input: Input,
  builder: (input) => ({ query: input.query }),
});
defineRequest({ method: "GET", path: "/health" });
defineRequest({
  method: "GET",
  path: "/health",
  builder: () => ({ headers: { "x-version": "1" } }),
});
defineEventStream({
  path: "/events",
  events: {},
  maxBufferSize: 1024,
  maxQueueSize: 4,
});
defineWebSocket({
  path: "/socket",
  incoming: struct.string(),
  maxIncomingQueueSize: 4,
});
