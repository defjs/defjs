// #region example
import { createWebSocketInterceptor } from "@defjs/core";

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request);

  return {
    get bufferedAmount() {
      return session.bufferedAmount;
    },
    get connection() {
      return session.connection;
    },
    get state() {
      return session.state;
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason);
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]();
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener);
    },
    onStateChange(listener) {
      return session.onStateChange(listener);
    },
    send(message: unknown) {
      session.send(message);
    },
  };
});
// #endregion
