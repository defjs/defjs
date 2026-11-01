import type { DerivableClient } from "@defjs/core";
import type { App, InjectionKey, Plugin } from "vue";
import { inject } from "vue";

/**
 * Vue injection key for the Defjs {@link DerivableClient} provided by {@link createClientPlugin}.
 *
 * Prefer {@link injectClient} over calling `inject(HTTP_CLIENT)` directly. `inject(HTTP_CLIENT)` returns `undefined` when nothing was provided. Override a subtree with `provide(HTTP_CLIENT, childClient)`.
 *
 * @group vue
 * @see {@link DerivableClient}
 * @see {@link injectClient}
 */
export const HTTP_CLIENT: InjectionKey<DerivableClient> = Symbol("HTTP_CLIENT");

/**
 * Create a Vue plugin that provides an existing Defjs client via {@link HTTP_CLIENT}.
 *
 * Does not create, cache, or dispose the client — pass the client returned by `createClient`. Installing it calls `app.provide(HTTP_CLIENT, client)`, so components read the client with `injectClient()`. The client is stored as given: it is not wrapped in `ref`, `reactive`, or `markRaw`.
 *
 * @param client - The client returned by `createClient` to provide to the app.
 * @returns A Vue `Plugin` for `app.use(...)`.
 *
 * @group vue
 * @see {@link DerivableClient}
 * @exampleFile examples/api/create-client-plugin.ts#example
 */
export function createClientPlugin(client: DerivableClient): Plugin {
  return {
    install(app: App) {
      app.provide(HTTP_CLIENT, client);
    },
  };
}

/**
 * Vue composable that injects the Defjs client for a key, defaulting to {@link HTTP_CLIENT}.
 *
 * `injectClient(key)` reads the nearest provider for that key; omitted or `undefined` uses `HTTP_CLIENT`. Call in a valid Vue injection context: synchronous `setup()`, compiler-restored `<script setup>` after top-level `await`, or a synchronous `app.runWithContext()` callback (Vue 3.3+). `app.runWithContext()` supplies only synchronous app-level context, not subtree overrides or context across ordinary `await`.
 *
 * For a custom `InjectionKey<DerivableClient>`, use `app.provide(key, client)` or an ancestor’s `provide(key, client)`. Share the same `Symbol` object; matching descriptions do not make keys equal. `createClientPlugin(client)` still takes only the client and provides `HTTP_CLIENT`.
 *
 * It returns the exact client value provided for the selected key, and throws an `Error` without an active injection context or a client for the selected key. Installing the plugin alone does not establish an injection context.
 *
 * The injected `DerivableClient` is a function. Call it with request options at the call site to derive a `Client` value for one call: `getUser(client({ signal }), input)`. Do not pass it to `watch` or `computed` as the source: Vue calls a function source. Do not wrap it in `ref` or `reactive`. The provider holds only a root client; a derived `Client` value is not accepted, so create it where the operation is called.
 *
 * @param key - Injection key; use the same object with `app.provide` or `provide`.
 * Defaults to `HTTP_CLIENT`, as provided by {@link createClientPlugin}.
 * @returns The injected derivable client.
 * @throws If called outside a Vue injection context or no client was provided for
 * the requested key. A missing custom key does not fall back to `HTTP_CLIENT`.
 *
 * @example
 * ```ts
 * const client = injectClient()
 * ```
 * @group vue
 * @see {@link DerivableClient}
 */
export function injectClient(
  key: InjectionKey<DerivableClient> = HTTP_CLIENT,
): DerivableClient {
  const client = inject(key);
  if (!client) {
    throw new Error(
      key === HTTP_CLIENT
        ? "No Defjs client available. Call injectClient() in a Vue injection context (such as synchronous setup() or app.runWithContext()) and provide a client with app.use(createClientPlugin(client)) or provide(HTTP_CLIENT, client)."
        : "No Defjs client available for the requested injection key. Call injectClient(key) in a Vue injection context and provide a client with app.provide(key, client) or provide(key, client). Use the same key object when providing and injecting.",
    );
  }
  return client;
}
