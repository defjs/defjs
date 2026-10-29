import { commands } from "vitest/browser";
import type {
  APIResponse,
  Browser,
  BrowserContext,
  Locator,
  Page,
  Response,
} from "playwright";
import type { Encoded, Handle, Ref, Step } from "./protocol";

/** Methods that build a Locator lazily and therefore need no round trip. */
const locatorBuilders = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "filter",
  "first",
  "last",
  "nth",
  "and",
  "or",
]);

type RemoteOf<T> = T extends Locator
  ? Remote<Locator>
  : T extends Page
    ? Remote<Page>
    : T extends BrowserContext
      ? Remote<BrowserContext>
      : T extends Browser
        ? Remote<Browser>
        : T extends Response | APIResponse
          ? Remote<T>
          : T;

type Wrapped<R> = R extends Locator
  ? Remote<Locator>
  : R extends Promise<infer Value>
    ? Promise<RemoteOf<Value>>
    : Promise<RemoteOf<R>>;

type Mapped<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer R
    ? (...args: Args) => Wrapped<R>
    : T[K] extends object
      ? Remote<T[K]>
      : never;
};

/** Playwright's generic evaluators lose their result type through `infer`, so they are spelled out. */
type Evaluators<T> = T extends Locator
  ? {
      evaluate<R>(
        pageFunction: (element: HTMLElement | SVGElement) => R | Promise<R>,
      ): Promise<R>;
      evaluateAll<R>(
        pageFunction: (
          elements: (HTMLElement | SVGElement)[],
        ) => R | Promise<R>,
      ): Promise<R>;
    }
  : T extends Page
    ? {
        evaluate<R>(pageFunction: () => R | Promise<R>): Promise<R>;
        waitForFunction(pageFunction: () => unknown): Promise<void>;
      }
    : object;

/**
 * A Playwright object that lives in the Node process. Every call is forwarded through a Vitest
 * browser command, so synchronous Playwright methods such as `page.url()` become promises.
 */
export type Remote<T> = Omit<Mapped<T>, keyof Evaluators<T>> &
  Evaluators<T> &
  AsyncDisposable;

interface Origin {
  token: string;
  ref: Ref;
}

const origins = new WeakMap<object, Origin>();

function encode(value: unknown): Encoded {
  if (typeof value === "function") {
    const origin = origins.get(value);
    if (origin) return { __ref: origin.ref };
    return { __fn: value.toString() };
  }
  if (value instanceof RegExp) return { __re: [value.source, value.flags] };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, encode(v)]),
    );
  return value as Encoded;
}

function proxy<T>(token: string, handle: Handle, steps: Step[]): T {
  const ref: Ref = { handle, steps };
  const target = () => undefined;
  const instance = new Proxy(target, {
    get(_target, name) {
      // Never thenable: an awaited remote must resolve to itself rather than to a round trip.
      if (name === "then") return undefined;
      if (name === Symbol.asyncDispose)
        return async () => {
          await commands.e2eCall(token, {
            handle,
            steps: [...steps, { name: "close", args: [] }],
          });
        };
      if (typeof name === "symbol") return undefined;
      return proxy(token, handle, [...steps, { name }]);
    },
    apply(_target, _this, args: unknown[]) {
      const last = steps.at(-1);
      if (!last) throw new TypeError("A remote root is not callable");
      const call = [
        ...steps.slice(0, -1),
        { name: last.name, args: args.map(encode) },
      ];
      if (locatorBuilders.has(last.name)) return proxy(token, handle, call);
      return commands
        .e2eCall(token, { handle, steps: call })
        .then((reply) =>
          reply.kind === "handle"
            ? proxy(token, reply.handle, [])
            : reply.value,
        );
    },
  });
  origins.set(instance, { token, ref });
  return instance as T;
}

export const remoteOf = <T>(token: string, handle: Handle): Remote<T> =>
  proxy<Remote<T>>(token, handle, []);

export function originOf(value: object): Origin {
  const origin = origins.get(value);
  if (!origin) throw new TypeError("Not a remote Playwright object");
  return origin;
}
