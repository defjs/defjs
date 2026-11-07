<!-- #region example -->
<script setup lang="ts">
import { defineEventStream, struct, type EventStreamHandle } from "@defjs/core";
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
let disposed = false;
let stream: EventStreamHandle<unknown> | undefined;

const stop = () => {
  disposed = true;
  controller.abort();
  stream?.close("scope-disposed");
};
onScopeDispose(stop);

void (async () => {
  const [error, nextStream] = await deployEvents(
    client({ signal: controller.signal }),
  );
  if (error) {
    if (!disposed)
      errorMessage.value = `Unable to open deploy log (${error.code}).`;
    return;
  }

  stream = nextStream;
  if (disposed) {
    nextStream.close("scope-disposed");
    await nextStream.closed;
    return;
  }

  try {
    for await (const event of nextStream) {
      lines.value.push({ id: nextId++, text: event.data });
      if (lines.value.length > 100) lines.value.shift();
    }
  } catch (cause) {
    if (!disposed) {
      errorMessage.value = "Deploy log interrupted.";
      console.error("deployEvents failed", cause);
    }
  } finally {
    nextStream.close("scope-finished");
    await nextStream.closed;
  }
})();
</script>

<template>
  <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
  <ul>
    <li v-for="line in lines" :key="line.id">{{ line.text }}</li>
  </ul>
</template>
<!-- #endregion -->
