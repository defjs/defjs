import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

/** A changed catalog must recompile overview pages; the remark plugin reads the file on each compile. */
function watchApiReference(): Plugin {
  return {
    name: "api-reference-reload",
    configureServer(server) {
      const file = `${server.config.root}/app/data/api-reference.json`;
      if (Bun.file(file).size === 0) return;
      const target = file.replaceAll("//", "/");
      server.watcher.add(target);
      server.watcher.on("change", (changed) => {
        if (changed.replaceAll("//", "/") !== target) return;
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
      Bun.env["SITE_URL"] ?? "http://localhost:3000",
    ),
  },
  plugins: [fumadocsMdx(), watchApiReference(), tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
});
