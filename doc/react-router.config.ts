import type { Config } from "@react-router/dev/config";
import { collectPrerenderPaths } from "./app/lib/routes";
export default {
  ssr: false,
  prerender: collectPrerenderPaths,
} satisfies Config;
