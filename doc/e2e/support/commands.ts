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

function revive(session: Session, browser: Browser, value: Encoded): unknown {
  if (Array.isArray(value))
    return value.map((v) => revive(session, browser, v));
  if (typeof value !== "object" || value === null) return value;
  if ("__fn" in value)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-base-to-string -- INTENT: preserve original serialized-function coercion, invocation, and promise-based closer behavior
    return new Function(`return (${String(value["__fn"])})`)();
  if ("__re" in value) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve native RegExp coercion and failures for serialized values without new validation
    const [source, flags] = value["__re"] as [string, string];
    return new RegExp(source, flags);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve original remote-handle lookup and failure behavior without validating the wire object
  if ("__ref" in value) return walk(session, browser, value["__ref"] as Ref);
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, revive(session, browser, v)]),
  );
}

function walk(session: Session, browser: Browser, ref: Ref): unknown {
  let current: unknown =
    ref.handle === "browser" ? browser : session.handles.get(ref.handle);
  if (current === undefined)
    throw new Error(`Unknown e2e handle: ${ref.handle}`);
  for (const step of ref.steps) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve JavaScript member access on callable and primitive remote owners
    const owner = current as Record<string, unknown>;
    const member = owner[step.name];
    current = step.args
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve original member.apply lookup and invocation ordering
        (member as (...args: unknown[]) => unknown).apply(
          owner,
          step.args.map((arg) => revive(session, browser, arg)),
        )
      : member;
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

const isPlainValue = (value: unknown) =>
  typeof value !== "object" ||
  value === null ||
  Array.isArray(value) ||
  Object.getPrototypeOf(value) === Object.prototype;

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
  if ((last === "newPage" || last === "newContext") && !isPlainValue(result)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve context-based closer ownership without duck-typing or skipping returned handles
    const created = result as Page | BrowserContext;
    session.closers.push(async () => {
      const owner = "context" in created ? created.context() : created;
      await owner.close();
    });
  }
  if (isPlainValue(result)) return { kind: "value", value: result };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve original registration and native WeakMap failures for non-plain results
  return { kind: "handle", handle: register(session, result as object) };
};

export const e2eExtend: BrowserCommand<
  [string, ExtensionName, Ref, ...Encoded[]]
> = async ({ context }, token, name, pageRef, ...options) => {
  const session = sessionOf(token);
  const browser = browserOf(context);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve original page operation failures without an added page-shape check
  const page = walk(session, browser, pageRef) as Page;
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
  // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: preserve original serialized-function coercion, invocation, and promise-based closer behavior
  session.closers.unshift(async () => gate.resolve());
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve the route matcher values accepted by Playwright without restricting them to this realm RegExp
  await page.route(first as RegExp, async (route) => {
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
