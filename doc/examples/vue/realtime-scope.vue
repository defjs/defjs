<!-- #region example -->
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
<!-- #endregion -->
