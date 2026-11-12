import { defineConfig } from "tsdown";
import { bundleOptions, libraryConfig } from "../../tsdown.shared.ts";
import manifest from "./package.json" with { type: "json" };

const index = "src/index.ts";
const cdnBundle = "./index.min.js";

export default defineConfig([
  libraryConfig(
    manifest,
    { index, xsrf: "src/xsrf/index.ts" },
    { unpkg: cdnBundle, jsdelivr: cdnBundle },
  ),
  // The minified bundle that the CDN fields point at.
  {
    ...bundleOptions,
    clean: false,
    dts: false,
    minify: true,
    entry: { "index.min": index },
  },
]);
