<!-- #region example -->
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
<!-- #endregion -->
