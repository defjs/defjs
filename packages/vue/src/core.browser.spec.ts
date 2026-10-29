import {
  createClient,
  createHttpInterceptor,
  defineRequest,
  struct,
  type Client,
  withEndpoint,
  withInterceptors,
} from "@defjs/core";
import { afterEach, beforeEach, describe, expect, inject, test } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  provide,
  ref,
  type App,
  type Component,
  type InjectionKey,
} from "vue";
import { createClientPlugin, HTTP_CLIENT, injectClient } from "./index";

const passthroughHttpInterceptor = createHttpInterceptor((req, next) =>
  next(req),
);

const UserStruct = struct.object({
  id: struct.number(),
  name: struct.string(),
});

const getUsers = defineRequest({
  method: "GET",
  output: struct.array(UserStruct),
  path: "/api/users",
});

type Users = Array<{ id: number; name: string }>;
type UsersResult = [unknown, unknown, unknown];

const expectedUsers = [
  { id: 1, name: "John" },
  { id: 2, name: "Jane" },
] satisfies Users;

const mountedApps: Array<() => void> = [];

function mountRuntime(component: Component, configure?: (app: App) => void) {
  const root = document.createElement("div");
  document.body.appendChild(root);

  const app = createApp(component);
  configure?.(app);

  let mounted = false;
  mountedApps.push(() => {
    if (mounted) {
      app.unmount();
    }

    root.remove();
  });

  app.mount(root);
  mounted = true;

  return root;
}

function renderedListItems(root: ParentNode) {
  return Array.from(root.querySelectorAll("li")).map(
    (item) => item.textContent,
  );
}

describe("vue browser runtime", () => {
  let testServerHost: string;

  beforeEach(() => {
    testServerHost = inject("testServerHost");
  });

  afterEach(() => {
    for (const cleanup of mountedApps.splice(0).reverse()) {
      cleanup();
    }
  });

  test("provides the exact client instance supplied by the caller", () => {
    const client = createClient(withEndpoint(testServerHost));
    let injectedClient: Client | undefined;

    const Consumer = defineComponent({
      name: "PluginClientConsumer",
      setup() {
        injectedClient = injectClient();
        return () => h("div");
      },
    });

    const plugin = createClientPlugin(client);
    expect(plugin).toHaveProperty("install");

    mountRuntime(Consumer, (app) => {
      app.use(plugin);
    });

    expect(injectedClient).toBe(client);
  });

  test("shares one client through multiple Vue component layers", () => {
    const client = createClient(withEndpoint(testServerHost));
    let middleClient: Client | undefined;
    let leafClient: Client | undefined;

    const Leaf = defineComponent({
      name: "LeafClientConsumer",
      setup() {
        leafClient = injectClient();
        return () => h("span");
      },
    });

    const Middle = defineComponent({
      name: "MiddleClientConsumer",
      setup() {
        middleClient = injectClient();
        return () => h(Leaf);
      },
    });

    mountRuntime(Middle, (app) => {
      app.use(createClientPlugin(client));
    });

    expect(middleClient).toBe(client);
    expect(leafClient).toBe(client);
  });

  test("provides to descendants while reading the ancestor in the provider", () => {
    const outer = createClient();
    const inner = createClient();
    let ownClient: Client | undefined;
    let childClient: Client | undefined;

    const Child = defineComponent({
      setup() {
        childClient = injectClient();
        return () => h("div");
      },
    });
    const Boundary = defineComponent({
      setup() {
        provide(HTTP_CLIENT, inner);
        ownClient = injectClient();
        return () => h(Child);
      },
    });

    mountRuntime(Boundary, (app) => {
      app.use(createClientPlugin(outer));
    });

    expect(ownClient).toBe(outer);
    expect(childClient).toBe(inner);
  });

  test("overrides one custom key without changing the default or siblings", () => {
    const normal = createClient();
    const outerBilling = createClient();
    const innerBilling = createClient();
    const key: InjectionKey<Client> = Symbol("billing");
    let boundaryClient: Client | undefined;
    let childBilling: Client | undefined;
    let childDefault: Client | undefined;
    let siblingBilling: Client | undefined;

    const Child = defineComponent({
      setup() {
        childBilling = injectClient(key);
        childDefault = injectClient();
        return () => h("div");
      },
    });
    const Boundary = defineComponent({
      setup() {
        provide(key, innerBilling);
        boundaryClient = injectClient(key);
        return () => h(Child);
      },
    });
    const Sibling = defineComponent({
      setup() {
        siblingBilling = injectClient(key);
        return () => h("div");
      },
    });
    const Root = defineComponent({
      setup() {
        return () => [h(Boundary), h(Sibling)];
      },
    });

    mountRuntime(Root, (app) => {
      app.use(createClientPlugin(normal));
      app.provide(key, outerBilling);
    });

    expect(boundaryClient).toBe(outerBilling);
    expect(childBilling).toBe(innerBilling);
    expect(childDefault).toBe(normal);
    expect(siblingBilling).toBe(outerBilling);
  });

  test("renders data fetched by the injected client", async () => {
    let usersRequest: Promise<void> | undefined;

    const UserList = defineComponent({
      name: "InjectedClientUserList",
      setup() {
        const users = ref<Users>([]);
        const errorMessage = ref("");
        const isLoading = ref(true);
        const client = injectClient();

        usersRequest = client.execute(getUsers()).then(([error, result]) => {
          isLoading.value = false;

          if (error) {
            errorMessage.value = "Failed to load users";
            return;
          }

          users.value = result as Users;
        });

        return () =>
          h("section", { "aria-label": "Users result" }, [
            isLoading.value ? h("p", "Loading users") : null,
            errorMessage.value
              ? h("p", { role: "alert" }, errorMessage.value)
              : null,
            users.value.length
              ? h(
                  "ul",
                  { "aria-label": "Users" },
                  users.value.map((user) =>
                    h("li", { key: user.id }, user.name),
                  ),
                )
              : null,
          ]);
      },
    });

    const client = createClient(
      withEndpoint(testServerHost),
      withInterceptors(passthroughHttpInterceptor),
    );
    const root = mountRuntime(UserList, (app) => {
      app.use(createClientPlugin(client));
    });

    expect(root.textContent).toContain("Loading users");

    if (!usersRequest) {
      throw new Error("Expected user list request");
    }

    await usersRequest;
    await nextTick();

    expect(renderedListItems(root)).toEqual(["John", "Jane"]);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  test("resolves the nearest Vue provider and renders scoped request results", async () => {
    const seenScopes: string[] = [];
    let outerClient: Client | undefined;
    let outerSiblingClient: Client | undefined;
    let innerMiddleClient: Client | undefined;
    let innerLeafClient: Client | undefined;
    let outerRequest: Promise<UsersResult> | undefined;
    let innerRequest: Promise<UsersResult> | undefined;

    const scopedInterceptor = (scope: string) =>
      createHttpInterceptor(async (req, next) => {
        seenScopes.push(scope);
        req.headers?.set("x-defjs-scope", scope);
        return next(req);
      });

    const outer = createClient(
      withEndpoint(testServerHost),
      withInterceptors(scopedInterceptor("outer")),
    );
    const inner = createClient(
      withEndpoint(testServerHost),
      withInterceptors(scopedInterceptor("inner")),
    );

    const OuterRequestConsumer = defineComponent({
      name: "OuterRequestConsumer",
      setup() {
        const userNames = ref("loading");

        outerClient = injectClient();
        outerRequest = (
          outerClient.execute(getUsers()) as Promise<UsersResult>
        ).then((result) => {
          const [error, users] = result;
          userNames.value = error
            ? "error"
            : (users as Users).map((user) => user.name).join(", ");
          return result;
        });

        return () =>
          h("section", { "data-scope": "outer" }, `outer: ${userNames.value}`);
      },
    });

    const OuterSiblingConsumer = defineComponent({
      name: "OuterSiblingConsumer",
      setup() {
        outerSiblingClient = injectClient();
        return () =>
          h("span", { "data-scope": "outer-sibling" }, "outer sibling ready");
      },
    });

    const InnerLeaf = defineComponent({
      name: "InnerLeafConsumer",
      setup() {
        const userNames = ref("loading");

        innerLeafClient = injectClient();
        innerRequest = (
          innerLeafClient.execute(getUsers()) as Promise<UsersResult>
        ).then((result) => {
          const [error, users] = result;
          userNames.value = error
            ? "error"
            : (users as Users).map((user) => user.name).join(", ");
          return result;
        });

        return () =>
          h("section", { "data-scope": "inner" }, `inner: ${userNames.value}`);
      },
    });

    const InnerMiddle = defineComponent({
      name: "InnerMiddleConsumer",
      setup() {
        innerMiddleClient = injectClient();
        return () => h(InnerLeaf);
      },
    });

    const InnerProvider = defineComponent({
      name: "InnerClientProvider",
      setup() {
        provide(HTTP_CLIENT, inner);
        return () => h(InnerMiddle);
      },
    });

    const Root = defineComponent({
      name: "RootClientProviderConsumer",
      setup() {
        return () => [
          h(OuterRequestConsumer),
          h(InnerProvider),
          h(OuterSiblingConsumer),
        ];
      },
    });

    const root = mountRuntime(Root, (app) => {
      app.use(createClientPlugin(outer));
    });

    expect(root.querySelector('[data-scope="outer"]')?.textContent).toBe(
      "outer: loading",
    );
    expect(root.querySelector('[data-scope="inner"]')?.textContent).toBe(
      "inner: loading",
    );

    if (!outerRequest || !innerRequest) {
      throw new Error("Expected nested client requests");
    }

    const [[outerError, outerUsers], [innerError, innerUsers]] =
      await Promise.all([outerRequest, innerRequest]);
    await nextTick();

    expect(root.querySelector('[data-scope="outer"]')?.textContent).toBe(
      "outer: John, Jane",
    );
    expect(root.querySelector('[data-scope="inner"]')?.textContent).toBe(
      "inner: John, Jane",
    );
    expect(
      root.querySelector('[data-scope="outer-sibling"]')?.textContent,
    ).toBe("outer sibling ready");
    expect(outerError).toBeNull();
    expect(outerUsers).toEqual(expectedUsers);
    expect(innerError).toBeNull();
    expect(innerUsers).toEqual(expectedUsers);
    expect(outerClient).toBe(outer);
    expect(outerSiblingClient).toBe(outer);
    expect(innerMiddleClient).toBe(inner);
    expect(innerLeafClient).toBe(inner);
    expect([...seenScopes].sort()).toEqual(["inner", "outer"]);
  });

  test("throws a helpful error when no provider is installed", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const Consumer = defineComponent({
      name: "MissingProviderConsumer",
      setup() {
        injectClient();
        return () => h("div");
      },
    });

    const app = createApp(Consumer);
    app.config.warnHandler = () => {};

    try {
      expect(() => app.mount(root)).toThrow(
        "No Defjs client available. Call injectClient() in a Vue injection context (such as synchronous setup() or app.runWithContext()) and provide a client with app.use(createClientPlugin(client)) or provide(HTTP_CLIENT, client).",
      );
    } finally {
      root.remove();
    }
  });
});
