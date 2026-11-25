// #region example
import { generateOpenApi } from "@defjs/cli";

async function main() {
  const result = await generateOpenApi({
    cwd: process.cwd(),
    target: {
      input: "./openapi/orders.yaml",
      output: { dir: "./src/sdk/orders", format: "ts" },
      mode: "sync",
      errorStrategy: "union",
    },
  });

  console.log("written:", result.written.length);
  for (const diagnostic of result.diagnostics) {
    console.warn(diagnostic.code, diagnostic.message);
  }
}

void main();
// #endregion
