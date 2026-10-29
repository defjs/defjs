import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

/** A changed catalog must recompile overview pages; the remark plugin reads the file on each compile. */
function watchApiReference(): Plugin {
  return {
    name: "api-reference-reload",
    configureServer(server) {
      const file = join(server.config.root, "app/data/api-reference.json");
      if (!existsSync(file)) return;
      const target = resolve(file);
      server.watcher.add(target);
      server.watcher.on("change", (changed) => {
        if (resolve(changed) !== target) return;
        for (const mod of server.moduleGraph.idToModuleMap.values())
          server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig({
  define: {
    "import.meta.env.SITE_URL": JSON.stringify(
      process.env["SITE_URL"] ?? "http://localhost:3000",
    ),
  },
  plugins: [fumadocsMdx(), watchApiReference(), tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
});
