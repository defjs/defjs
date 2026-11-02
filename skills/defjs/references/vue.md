# Vue integration (`@defjs/vue`)

Contents: [Boundary and exports](#boundary-and-exports) · [Plugin installation](#plugin-installation) · [Reactive `watch` with cancellation](#reactive-watch-with-cancellation) · [Subtree override and custom `InjectionKey`](#subtree-override-and-custom-injectionkey) · [Owning SSE or WebSocket in a Vue scope](#owning-sse-or-websocket-in-a-vue-scope)

## Boundary and exports

`@defjs/vue` exports `HTTP_CLIENT`, `createClientPlugin`, and `injectClient`.

- It is a thin provide/inject bridge, **not** a query or state library.
- Do not pass the `DerivableClient` returned by `injectClient()` as the first argument to `watch(client, ...)` or `computed(client)`—because `DerivableClient` is a function, Vue would treat it as a getter source and invoke `client()`. Do not wrap it in `ref()` or `reactive()`.

## Plugin installation

```ts
import { createClient, withEndpoint } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";
import { createApp } from "vue";
import App from "./App.vue";

const client = createClient(withEndpoint("https://api.example.com"));
const app = createApp(App);

app.use(createClientPlugin(client));
app.mount("#app");
```

- During SSR, create and install a separate client per request when headers, cookies, or tenant credentials differ.

## Reactive `watch` with cancellation

Define endpoints at module scope. Inside `<script setup lang="ts">`, call `injectClient()` synchronously and use `onCleanup` in `watch` to abort stale requests:

```vue
<script setup lang="ts">
import { defineRequest, struct } from "@defjs/core";
import { injectClient } from "@defjs/vue";
import { ref, watch } from "vue";

const props = defineProps<{ id: number }>();
const client = injectClient();
const status = ref("Loading...");

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
          status.value = "Unable to load order.";
          return;
        }
        status.value = order.status;
      },
    );
  },
  { immediate: true },
);
</script>

<template>
  <span>{{ status }}</span>
</template>
```

## Subtree override and custom `InjectionKey`

- Override the default client for a component subtree with `provide(HTTP_CLIENT, childClient)`.
- For multiple clients (for example a billing service and an orders service), create a shared `Symbol` typed as `InjectionKey<DerivableClient>`, provide it with `app.provide(BILLING_CLIENT, billingClient)`, and read it with `injectClient(BILLING_CLIENT)`. A missing custom key throws instead of falling back to `HTTP_CLIENT`.

## Owning SSE or WebSocket in a Vue scope

Tie long-lived streams and sessions to `onScopeDispose` so they close automatically when the component or `effectScope` is disposed:

```vue
<script setup lang="ts">
import { defineEventStream, struct, type EventStreamHandle } from "@defjs/core";
import { injectClient } from "@defjs/vue";
import { onScopeDispose, ref } from "vue";

const client = injectClient();
const lines = ref<{ id: number; text: string }[]>([]);
let nextId = 0;

const deployEvents = defineEventStream({
  path: "/deployments/events",
  events: { line: struct.string() },
});

const controller = new AbortController();
let disposed = false;
let stream: EventStreamHandle<unknown> | undefined;

onScopeDispose(() => {
  disposed = true;
  controller.abort();
  stream?.close("scope-disposed");
});

void (async () => {
  const [error, nextStream] = await deployEvents(
    client({ signal: controller.signal }),
  );
  if (error) return;
  stream = nextStream;
  if (disposed) {
    nextStream.close("scope-disposed");
    await nextStream.closed;
    return;
  }
  try {
    for await (const event of nextStream) {
      lines.value.push({ id: nextId++, text: event.data });
    }
  } finally {
    nextStream.close("scope-finished");
    await nextStream.closed;
  }
})();
</script>
```
