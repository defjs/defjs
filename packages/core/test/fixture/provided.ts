import type {} from "vitest";
import type { Round13Settings } from "../round13-settings.ts";

declare module "vitest" {
  interface ProvidedContext {
    testServerHost: string;
    rawServerOrigin: string;
    refusedOrigin: string;
    fixtureToken: string;
    round13: Round13Settings;
  }
}
