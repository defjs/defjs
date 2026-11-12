# Vue [#vue]

`@defjs/vue` wires an application-owned `@defjs/core` client into a Vue 3.2+ application via `createClientPlugin(client)`, `HTTP_CLIENT`, and `injectClient()`. Your SDK definitions remain pure `@defjs/core` modules with zero Vue dependencies.

```sh
bun add @defjs/core @defjs/vue vue
```

## What `@defjs/vue` owns vs. what you own [#what-defjsvue-owns-vs-what-you-own]

- **Provided by `@defjs/vue`**: `createClientPlugin(client)`, `HTTP_CLIENT` (`InjectionKey<DerivableClient>`), and `injectClient(key?)`.
- **Owned by your application**: creating the [`DerivableClient`](/api/core/derivableclient-type), aborting in-flight work in watchers (`onCleanup`) or composables (`onScopeDispose`), closing SSE/WebSocket handles, and integrating query libraries (such as Vue Query).
- **Important**: `injectClient()` returns the `DerivableClient` function-object. Call `client({ signal })` where the operation runs (`getOrder(client({ signal }), input)`). Never pass `client` as the first argument to `watch(client, ...)` or `computed(client)` because Vue treats a function argument as a reactive getter.

---

## 1. Install the plugin and fetch in a watcher [#1-install-the-plugin-and-fetch-in-a-watcher]

Create the client in your application entry, install `createClientPlugin(client)`, and register `onCleanup` before starting async work inside a watcher:

<Tabs items={["src/main.ts", "src/basic-setup.vue"]}>
  <Tab>
    ```typescript
    import { createClient, withEndpoint } from "@defjs/core";
    import { createClientPlugin } from "@defjs/vue";
    import { createApp } from "vue";
    import OrderView from "./basic-setup.vue";

    const client = createClient(withEndpoint("https://api.example.com"));
    const app = createApp(OrderView, { id: 7 });

    app.use(createClientPlugin(client));
    app.mount("#app");
    ```

  </Tab>
  <Tab>
    ```vue
    <script setup lang="ts">
    import { defineRequest, struct } from "@defjs/core";
    import { injectClient } from "@defjs/vue";
    import { ref, watch } from "vue";

    const props = defineProps<{ id: number }>();
    const client = injectClient();
    const name = ref("Loading...");

    const getOrder = defineRequest({
      method: "GET",
      path: "/orders/:id",
      input: struct.object({ id: struct.number() }),
      builder: (input) => ({ path: { id: input.id } }),
      output: struct.object({ status: struct.string() }),
    });

    watch(
      () => props.id,
      (id, _previousId, onCleanup) => {
        const controller = new AbortController();
        onCleanup(() => controller.abort());

        void getOrder(client({ signal: controller.signal }), { id }).then(
          ([error, order]) => {
            if (controller.signal.aborted) return;
            if (error) {
              name.value = "Unable to load order.";
              return;
            }
            name.value = order.status;
          },
        );
      },
      { immediate: true },
    );
    </script>

    <template>
      <span>{{ name }}</span>
    </template>
    ```

  </Tab>
</Tabs>

- `createClientPlugin(client)` provides the exact `DerivableClient` instance under `HTTP_CLIENT` without cloning it or registering unmount disposal hooks.
- `onCleanup` runs both before the watcher re-executes and when the component unmounts.

---

## 2. Inject and override in subtrees [#2-inject-and-override-in-subtrees]

`injectClient(key?)` looks up the nearest provider for `key` (defaulting to `HTTP_CLIENT`) and throws an `Error` if called outside an active Vue injection context (`setup()` or `app.runWithContext()`) or if no client is provided for that key.

You can override the client for a component subtree using Vue's native `provide(HTTP_CLIENT, childClient)`:

```vue
<script setup lang="ts">
import { createClient, withEndpoint } from "@defjs/core";
import { HTTP_CLIENT, injectClient } from "@defjs/vue";
import { defineComponent, h, provide } from "vue";

const childClient = createClient(withEndpoint("https://tenant.example.com"));
const Child = defineComponent({
  setup() {
    const client = injectClient();
    return () =>
      h(
        "span",
        client === childClient
          ? "Child client is provided"
          : "Unexpected client",
      );
  },
});

provide(HTTP_CLIENT, childClient);
</script>

<template>
  <Child />
</template>
```

- Descendants receive `childClient`, while sibling subtrees keep the root client.
- If a helper function accepts an optional explicit client (`explicitClient ?? injectClient()`), only the fallback branch requires an active Vue injection context. Capture the client synchronously during `setup()` before any `await`.

---

## 3. Clean up SSE & WebSocket streams on scope disposal [#3-clean-up-sse--websocket-streams-on-scope-disposal]

For work started inside a composable or component outside a watcher, pair `AbortController` with `onScopeDispose`. The signal covers startup and the open stream, so aborting it is the whole cleanup. Consume the single async iterator, then close the handle and await `.closed` in `finally`:

```vue
<script setup lang="ts">
import { defineEventStream, struct } from "@defjs/core";
import { injectClient } from "@defjs/vue";
import { onScopeDispose, ref } from "vue";

const client = injectClient();
const errorMessage = ref<string>();
const lines = ref<{ id: number; text: string }[]>([]);
let nextId = 0;
const deployEvents = defineEventStream({
  path: "/deployments/events",
  events: { line: struct.string() },
});

const controller = new AbortController();
onScopeDispose(() => controller.abort());

void (async () => {
  const [error, stream] = await deployEvents(
    client({ signal: controller.signal }),
  );
  if (error) {
    if (error.code !== "NET_ABORTED")
      errorMessage.value = `Unable to open deploy log (${error.code}).`;
    return;
  }

  try {
    for await (const event of stream) {
      lines.value.push({ id: nextId++, text: event.data });
      if (lines.value.length > 100) lines.value.shift();
    }
  } catch (cause) {
    if (!controller.signal.aborted) {
      errorMessage.value = "Deploy log interrupted.";
      console.error("deployEvents failed", cause);
    }
  } finally {
    stream.close("scope-finished");
    await stream.closed;
  }
})();
</script>

<template>
  <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
  <ul>
    <li v-for="line in lines" :key="line.id">{{ line.text }}</li>
  </ul>
</template>
```

- The tuple error branch displays initial handshake failures (including HTTP 503). The iterator `catch` displays failures after startup; the `finally` block still closes and awaits the stream.
- Stopping the scope ends an SSE `for await` loop normally.
- Aborting a WebSocket session ends it as `aborted` and rejects `session.receive` with `AbortError`, so guard the `catch` block after disposal and unsubscribe `onStateChange` / `onRuntimeError` listeners in `finally`.

---

## 4. SSR and application scope [#4-ssr-and-application-scope]

- **Browser**: share a single client per Vue app when endpoint and interceptors are request-independent.
- **SSR**: create and install a fresh client per SSR request whenever headers, cookies, tenants, or credentials differ.
- Unmounting the Vue app or disposing a component scope does **not** automatically abort HTTP requests, close SSE/WebSocket streams, or dispose the core client.

---

## Public exports & related guides [#public-exports--related-guides]

- `HTTP_CLIENT` — `InjectionKey<DerivableClient>` for native `provide` / `inject`.
- `createClientPlugin(client)` — Vue `Plugin` providing `client` under `HTTP_CLIENT`.
- `injectClient(key?)` — resolves the nearest client for `key` (defaults to `HTTP_CLIENT`).
- Related guides: [Client](/docs/client), [HTTP operations](/docs/http), [Interceptors](/docs/interceptors), [SSE event streams](/docs/sse), [WebSocket sessions](/docs/web-socket).
- Related recipes: [GET with a declared 404](/recipes/get-declared-404), [Cancel an HTTP call](/recipes/cancel-http), [Consume an SSE stream](/recipes/consume-sse), [Open a WebSocket session](/recipes/websocket-session).
