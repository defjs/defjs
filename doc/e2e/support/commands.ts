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
    return new Function(`return (${String(value["__fn"])})`)();
  if ("__re" in value) {
    const [source, flags] = value["__re"] as [string, string];
    return new RegExp(source, flags);
  }
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
    const owner = current as Record<string, unknown>;
    const member = owner[step.name];
    current = step.args
      ? (member as (...args: unknown[]) => unknown).apply(
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
    const created = result as Page | BrowserContext;
    session.closers.push(async () => {
      const owner = "context" in created ? created.context() : created;
      await owner.close();
    });
  }
  if (isPlainValue(result)) return { kind: "value", value: result };
  return { kind: "handle", handle: register(session, result as object) };
};

export const e2eExtend: BrowserCommand<
  [string, ExtensionName, Ref, ...Encoded[]]
> = async ({ context }, token, name, pageRef, ...options) => {
  const session = sessionOf(token);
  const browser = browserOf(context);
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
  session.closers.unshift(async () => gate.resolve());
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
