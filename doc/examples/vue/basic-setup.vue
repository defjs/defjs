<!-- #region example -->
<script setup lang="ts">
import { defineRequest, struct } from "@defjs/core";
import { injectClient } from "@defjs/vue";
import { ref, watch } from "vue";

const props = defineProps<{ id: number }>();
const client = injectClient();
const name = ref("Loading...");

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ name: struct.string() }),
});

watch(
  () => props.id,
  (id, _previousId, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());

    const command = getUser({ id });
    void client
      .execute(command, { signal: controller.signal })
      .then(([error, user]) => {
        if (controller.signal.aborted) return;
        if (error) {
          name.value = "Unable to load user.";
          return;
        }
        name.value = user.name;
      });
  },
  { immediate: true },
);
</script>

<template>
  <span>{{ name }}</span>
</template>
<!-- #endregion -->
