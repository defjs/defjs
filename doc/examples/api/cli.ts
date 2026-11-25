// #region example
import { defineConfig, generateOpenApi } from "@defjs/cli";

export const config = defineConfig({
  openapi: {
    input: "./openapi/orders.yaml",
    output: { dir: "./src/sdk/orders", format: "ts" },
    mode: "sync",
    errorStrategy: "union",
  },
});

async function main() {
  const result = await generateOpenApi({
    cwd: process.cwd(),
    target: {
      input: "./openapi/orders.yaml",
      output: { dir: "./src/sdk/orders", format: "ts" },
    },
  });
  console.log(result.written.length);
}

void main();
// #endregion
