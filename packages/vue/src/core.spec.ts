import {
  createClient,
  defineRequest,
  struct,
  type DerivableClient,
  withEndpoint,
} from "@defjs/core";
import { afterEach, expect, inject, onTestFinished, test, vi } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  provide,
  ref,
  type Component,
  type InjectionKey,
} from "vue";
import { createClientPlugin, HTTP_CLIENT, injectClient } from "./index";

const getUsers = defineRequest({
  method: "GET",
  output: struct.array(
    struct.object({ id: struct.number(), name: struct.string() }),
  ),
  path: "/api/users",
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Vue reports a failed `inject()` outside a component through `console.warn`.
function silenceVueWarnings(): void {
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

function mount(component: Component, client: DerivableClient): HTMLElement {
  const root = document.body.appendChild(document.createElement("div"));
  const app = createApp(component);
  app.use(createClientPlugin(client));
  app.mount(root);
  onTestFinished(() => {
    app.unmount();
    root.remove();
  });
  return root;
}

test("the plugin provides the client it is given", () => {
  const client = createClient();
  let injected: DerivableClient | undefined;
  const Consumer = defineComponent({
    setup() {
      injected = injectClient();
      return () => h("div");
    },
  });

  mount(Consumer, client);

  expect(injected).toBe(client);
});

test("provide(HTTP_CLIENT) overrides the client for descendants, not for the providing component", () => {
  const outer = createClient();
  const inner = createClient();
  let own: DerivableClient | undefined;
  let child: DerivableClient | undefined;
  const Child = defineComponent({
    setup() {
      child = injectClient();
      return () => h("div");
    },
  });
  const Boundary = defineComponent({
    setup() {
      provide(HTTP_CLIENT, inner);
      own = injectClient();
      return () => h(Child);
    },
  });

  mount(Boundary, outer);

  expect(own).toBe(outer);
  expect(child).toBe(inner);
});

test("injectClient returns the client inside a synchronous app.runWithContext callback", () => {
  const client = createClient();
  const app = createApp({});
  app.use(createClientPlugin(client));

  expect(app.runWithContext(injectClient)).toBe(client);
});

test("the injection context does not survive an await", async () => {
  const client = createClient();
  const app = createApp({});
  app.use(createClientPlugin(client));
  silenceVueWarnings();

  const captured = await app.runWithContext(async () => {
    const current = injectClient();
    await Promise.resolve();
    expect(() => injectClient()).toThrow(/injection context/);
    return current;
  });

  expect(captured).toBe(client);
});

test("injectClient reads a custom key and leaves the default client alone", () => {
  const normal = createClient();
  const billing = createClient();
  const key: InjectionKey<DerivableClient> = Symbol("billing");
  const app = createApp({});
  app.use(createClientPlugin(normal));
  app.provide(key, billing);

  app.runWithContext(() => {
    expect(injectClient()).toBe(normal);
    expect(injectClient(undefined)).toBe(normal);
    expect(injectClient(HTTP_CLIENT)).toBe(normal);
    expect(injectClient(key)).toBe(billing);
  });
});

test("a missing custom key falls back neither to the default client nor to a key with the same description", () => {
  const key: InjectionKey<DerivableClient> = Symbol("billing");
  const otherKey: InjectionKey<DerivableClient> = Symbol("billing");
  const app = createApp({});
  app.use(createClientPlugin(createClient()));
  app.provide(key, createClient());
  silenceVueWarnings();

  expect(() => app.runWithContext(() => injectClient(otherKey))).toThrow(
    "No Defjs client available for the requested injection key. Call injectClient(key) in a Vue injection context and provide a client with app.provide(key, client) or provide(key, client). Use the same key object when providing and injecting.",
  );
});

test("installing the plugin does not establish an injection context", () => {
  const app = createApp({});
  app.use(createClientPlugin(createClient()));
  silenceVueWarnings();

  expect(() => injectClient()).toThrow(/injection context/);
});

test("injectClient throws in setup when no client is provided", () => {
  const app = createApp({
    setup() {
      injectClient();
      return () => h("div");
    },
  });
  app.config.warnHandler = () => {};

  expect(() => app.mount(document.createElement("div"))).toThrow(
    "No Defjs client available. Call injectClient() in a Vue injection context (such as synchronous setup() or app.runWithContext()) and provide a client with app.use(createClientPlugin(client)) or provide(HTTP_CLIENT, client).",
  );
});

test("a component renders data requested with the injected client", async () => {
  let request: Promise<void> | undefined;
  const UserList = defineComponent({
    setup() {
      const names = ref<string[]>([]);
      request = getUsers(injectClient()).then(([error, users]) => {
        names.value = error ? [error.code] : users.map((user) => user.name);
      });
      return () =>
        h(
          "ul",
          names.value.map((name) => h("li", name)),
        );
    },
  });

  const root = mount(
    UserList,
    createClient(withEndpoint(inject("testServerHost"))),
  );
  await request;
  await nextTick();

  expect(
    Array.from(root.querySelectorAll("li"), (item) => item.textContent),
  ).toEqual(["John", "Jane"]);
});
