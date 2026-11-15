import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, ContextManager } from "@opentelemetry/api";
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { onTestFinished } from "vitest";

/** The context manager an OpenTelemetry SDK registers on a server runtime, reduced to what the plugin uses. */
class AsyncLocalStorageContextManager implements ContextManager {
  readonly #storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.#storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    active: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.#storage.run(active, () => fn.call(thisArg, ...args));
  }

  bind<T>(_context: Context, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this.#storage.disable();
    return this;
  }
}

/** Registers an AsyncLocalStorage context manager until the test ends, so `context.with` reaches awaited code. */
export function useAsyncContext(): void {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  onTestFinished(() => {
    context.disable();
  });
}
