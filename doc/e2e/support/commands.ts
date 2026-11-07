import type { Browser, BrowserContext, Page, Request } from "playwright";
import type { BrowserCommand } from "vitest/node";
import type { Encoded, ExtensionName, Ref, Reply } from "./protocol.ts";

interface Session {
  handles: Map<number, object>;
  closers: Array<() => Promise<void>>;
  next: number;
}

const sessions = new Map<string, Session>();
let counter = 0;

function sessionOf(token: string): Session {
  const session = sessions.get(token);
  if (!session) throw new Error(`Unknown e2e session: ${token}`);
  return session;
}

const isRegExpParts = (value: unknown): value is [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "string" &&
  typeof value[1] === "string";

const isRef = (value: unknown): value is Ref =>
  typeof value === "object" &&
  value !== null &&
  "handle" in value &&
  (typeof value.handle === "number" || value.handle === "browser") &&
  "steps" in value &&
  Array.isArray(value.steps);

/**
 * Playwright sends a page function to the page as `String(fn)` and runs it only there, so the
 * transmitted source becomes the function's text instead of being evaluated in this process.
 */
function pageFunction(source: string): () => never {
  const fn = (): never => {
    throw new TypeError("A page function runs only in the browser page");
  };
  fn.toString = () => source;
  return fn;
}

function revive(session: Session, browser: Browser, value: Encoded): unknown {
  if (Array.isArray(value))
    return value.map((v) => revive(session, browser, v));
  if (typeof value !== "object" || value === null) return value;
  if ("__fn" in value && typeof value["__fn"] === "string")
    return pageFunction(value["__fn"]);
  if ("__re" in value && isRegExpParts(value["__re"])) {
    const [source, flags] = value["__re"];
    return new RegExp(source, flags);
  }
  if ("__ref" in value && isRef(value["__ref"]))
    return walk(session, browser, value["__ref"]);
  return Object.fromEntries(
    Object.entries(value).map(([key, v]: [string, Encoded]) => [
      key,
      revive(session, browser, v),
    ]),
  );
}

function walk(session: Session, browser: Browser, ref: Ref): unknown {
  let current: unknown =
    ref.handle === "browser" ? browser : session.handles.get(ref.handle);
  if (current === undefined)
    throw new Error(`Unknown e2e handle: ${ref.handle}`);
  for (const step of ref.steps) {
    const owner = current;
    if (
      (typeof owner !== "object" || owner === null) &&
      typeof owner !== "function"
    )
      throw new TypeError(`Cannot read "${step.name}" of ${typeof owner}`);
    const member: unknown = Reflect.get(owner, step.name);
    if (!step.args) {
      current = member;
      continue;
    }
    if (typeof member !== "function")
      throw new TypeError(`"${step.name}" is not a function`);
    current = Reflect.apply(
      member,
      owner,
      step.args.map((arg) => revive(session, browser, arg)),
    );
  }
  return current;
}

function register(session: Session, value: object): number {
  const handle = ++session.next;
  session.handles.set(handle, value);
  return handle;
}

function browserOf(context: BrowserContext): Browser {
  const browser = context.browser();
  if (!browser) throw new Error("The Vitest browser context has no browser");
  return browser;
}

/** A Playwright object that stays in this process and is passed back by handle. */
const isHandleValue = (value: unknown): value is object =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) !== Object.prototype;

interface Closable {
  close(): Promise<void>;
}

const isCloseable = (value: object): value is Page | BrowserContext =>
  "close" in value && typeof value.close === "function";

const isPage = (value: unknown): value is Page =>
  typeof value === "object" &&
  value !== null &&
  "route" in value &&
  typeof value.route === "function" &&
  "on" in value &&
  typeof value.on === "function" &&
  "addInitScript" in value &&
  typeof value.addInitScript === "function";

export const e2eOpen: BrowserCommand<[]> = () => {
  const token = `e2e-${++counter}`;
  sessions.set(token, { handles: new Map(), closers: [], next: 0 });
  return token;
};

export const e2eCall: BrowserCommand<[string, Ref]> = async (
  { context },
  token,
  ref,
): Promise<Reply> => {
  const session = sessionOf(token);
  const result = await walk(session, browserOf(context), ref);
  const last = ref.steps.at(-1)?.name;
  if (!isHandleValue(result)) return { kind: "value", value: result };
  if (last === "newPage" || last === "newContext") {
    if (!isCloseable(result))
      throw new TypeError(
        `${last} did not return a closable Playwright object`,
      );
    const created = result;
    session.closers.push(async () => {
      const owner: Closable =
        "context" in created ? created.context() : created;
      await owner.close();
    });
  }
  return { kind: "handle", handle: register(session, result) };
};

export const e2eExtend: BrowserCommand<
  [string, ExtensionName, Ref, ...Encoded[]]
> = async ({ context }, token, name, pageRef, ...options) => {
  const session = sessionOf(token);
  const browser = browserOf(context);
  const page = walk(session, browser, pageRef);
  if (!isPage(page)) throw new TypeError("e2eExtend needs a Playwright page");
  const [first] = options.map((option) => revive(session, browser, option));
  if (name === "errors") {
    const errors: string[] = [];
    const record = (message: string) => {
      errors.push(message);
      console.error(message);
    };
    page.on("pageerror", (error) =>
      record(`${error.name}: ${error.message}\n${error.stack ?? ""}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        record(message.text() + " at " + page.url());
    });
    // The stack must be serialized before navigation destroys the argument handles.
    void page.addInitScript(() => {
      const report = console.error;
      console.error = (...args) =>
        report(
          ...args.map((value: unknown) =>
            value instanceof Error
              ? `${value.name}: ${value.message}\n${value.stack ?? ""}`
              : value,
          ),
        );
    });
    return register(session, { values: () => errors });
  }
  if (name === "requests") {
    const prefix = String(first);
    const paths: string[] = [];
    page.on("request", (request: Request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith(prefix)) paths.push(pathname);
    });
    return register(session, { values: () => paths });
  }
  const gate = Promise.withResolvers<void>();
  const hold = {
    release: () => gate.resolve(),
  };
  session.closers.unshift(() => Promise.resolve(gate.resolve()));
  if (typeof first !== "string" && !(first instanceof RegExp))
    throw new TypeError("hold needs a URL string or a RegExp");
  await page.route(first, async (route) => {
    await gate.promise;
    await route.continue();
  });
  return register(session, hold);
};

export const e2eClose: BrowserCommand<[string]> = async (_context, token) => {
  const session = sessions.get(token);
  sessions.delete(token);
  for (const close of session?.closers ?? []) await close();
};
