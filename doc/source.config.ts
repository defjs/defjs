import { defineConfig } from "fumadocs-mdx/config";
import { remarkApiSignatures } from "./app/lib/api-signatures";

// Runs before the preset, so processed Markdown, search, and highlighting see a normal fence.
export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkApiSignatures, ...plugins],
  },
});
