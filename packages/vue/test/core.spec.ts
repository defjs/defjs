import { createClient, type Client } from "@defjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, type App, type InjectionKey } from "vue";
import { createClientPlugin, HTTP_CLIENT, injectClient } from "../src";

describe("injectClient", () => {
  it("describes both requirements outside an injection context even with the plugin installed", () => {
    const app = createApp({});
    app.use(createClientPlugin(createClient()));

    expect(() => injectClient()).toThrow(
      /injection context.*app\.use\(createClientPlugin\(client\)\).*provide\(HTTP_CLIENT, client\)/,
    );
  });

  it("returns the exact client inside a synchronous app.runWithContext callback", () => {
    const client = createClient();
    const app = createApp({});
    app.use(createClientPlugin(client));

    expect(app.runWithContext(injectClient)).toBe(client);
  });

  it("isolates and restores nested application contexts", () => {
    const first = createClient();
    const second = createClient();
    const appA = createApp({});
    const appB = createApp({});
    appA.use(createClientPlugin(first));
    appB.use(createClientPlugin(second));

    appA.runWithContext(() => {
      expect(injectClient()).toBe(first);
      appB.runWithContext(() => expect(injectClient()).toBe(second));
      expect(injectClient()).toBe(first);
    });
    expect(appB.runWithContext(injectClient)).toBe(second);
  });

  it("keeps a captured client but does not preserve context across await", async () => {
    const client = createClient();
    const app = createApp({});
    app.use(createClientPlugin(client));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const captured = await app.runWithContext(async () => {
        const current = injectClient();
        await Promise.resolve();
        expect(() => injectClient()).toThrow(/injection context/);
        return current;
      });

      expect(captured).toBe(client);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /inject\(\).*only be used/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("selects an application key without changing the default client", () => {
    const normal = createClient();
    const billing = createClient();
    const key: InjectionKey<Client> = Symbol("billing");
    const app = createApp({});
    app.use(createClientPlugin(normal));
    app.provide(key, billing);

    app.runWithContext(() => {
      expect(injectClient()).toBe(normal);
      expect(injectClient(undefined)).toBe(normal);
      expect(injectClient(HTTP_CLIENT)).toBe(normal);
      expect(injectClient(key)).toBe(billing);
      expect(injectClient()).toBe(normal);
    });
  });

  it("does not use the default client for a missing same-description key", () => {
    const key: InjectionKey<Client> = Symbol("billing");
    const otherKey: InjectionKey<Client> = Symbol("billing");
    const app = createApp({});
    app.use(createClientPlugin(createClient()));
    app.provide(key, createClient());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() => app.runWithContext(() => injectClient(otherKey))).toThrow(
        "No Defjs client available for the requested injection key.",
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(String(otherKey));
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/injection.*not found/);
    } finally {
      warn.mockRestore();
    }
  });

  it("isolates a custom key between applications", () => {
    const key: InjectionKey<Client> = Symbol("service");
    const first = createClient();
    const second = createClient();
    const appA = createApp({});
    const appB = createApp({});
    appA.provide(key, first);
    appB.provide(key, second);

    appA.runWithContext(() => {
      expect(injectClient(key)).toBe(first);
      appB.runWithContext(() => expect(injectClient(key)).toBe(second));
      expect(injectClient(key)).toBe(first);
    });
  });

  it("does not make custom-key lookup available outside injection context", () => {
    const key: InjectionKey<Client> = Symbol("service");
    const app = createApp({});
    app.provide(key, createClient());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() => injectClient(key)).toThrow(
        "No Defjs client available for the requested injection key.",
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /inject\(\).*only be used/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("throws when no client is provided", () => {
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
});

describe("createClientPlugin", () => {
  const mountedApps: App[] = [];

  afterEach(() => {
    for (const app of mountedApps.splice(0)) {
      app.unmount();
    }
  });

  it("provides the exact client instance supplied by the caller", () => {
    const client = createClient();
    let injectedClient: Client | undefined;
    const app = createApp({
      setup() {
        injectedClient = injectClient();
        return () => h("div");
      },
    });

    const plugin = createClientPlugin(client);
    expect(plugin).toHaveProperty("install");
    app.use(plugin);
    app.mount(document.createElement("div"));
    mountedApps.push(app);

    expect(injectedClient).toBe(client);
  });
});
