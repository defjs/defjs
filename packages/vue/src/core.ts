import type { Client } from '@defjs/core'
import type { App, InjectionKey, Plugin } from 'vue'
import { inject } from 'vue'

/**
 * Vue injection key for the Defjs {@link Client} provided by {@link createClientPlugin}.
 *
 * Prefer {@link injectClient} over calling `inject(HTTP_CLIENT)` directly.
 */
export const HTTP_CLIENT: InjectionKey<Client> = Symbol('HTTP_CLIENT')

/**
 * Create a Vue plugin that provides an existing Defjs client via {@link HTTP_CLIENT}.
 *
 * Does not create, cache, or dispose the client — pass an instance from `createClient`.
 *
 * @param client - The Client instance to provide to the app.
 * @returns A Vue `Plugin` for `app.use(...)`.
 *
 * @example
 * ```ts
 * app.use(createClientPlugin(client))
 * ```
 */
export function createClientPlugin(client: Client): Plugin {
  return {
    install(app: App) {
      app.provide(HTTP_CLIENT, client)
    },
  }
}

/**
 * Inject the Defjs client provided by {@link createClientPlugin}.
 *
 * Call in a Vue injection context: synchronous `setup()`, compiler-restored `<script setup>`
 * after top-level `await`, or a synchronous `app.runWithContext()` callback (Vue 3.3+).
 *
 * @returns The injected `Client` instance.
 * @throws If called outside a Vue injection context or no client was provided via
 * `app.use(createClientPlugin(client))` or `provide(HTTP_CLIENT, client)`.
 *
 * @example
 * ```ts
 * const client = injectClient()
 * ```
 */
export function injectClient(): Client {
  const client = inject(HTTP_CLIENT)
  if (!client) {
    throw new Error(
      'No Defjs client available. Call injectClient() in a Vue injection context (such as synchronous setup() or app.runWithContext()) and provide a client with app.use(createClientPlugin(client)) or provide(HTTP_CLIENT, client).',
    )
  }
  return client
}
