// #region example
import { defineConfig } from "@defjs/cli";
import ordersSpec from "./openapi/orders.json" with { type: "json" };

export default defineConfig({
  openapi: [
    {
      input: "./openapi/billing.yaml",
      output: { dir: "./src/sdk/billing", format: "ts" },
      mode: "sync",
      errorStrategy: "union",
      mixed2xxStrategy: "split",
    },
    {
      input: ordersSpec,
      output: { dir: "./src/sdk/orders", format: "mjs" },
      mode: "scaffold",
    },
  ],
});
// #endregion
