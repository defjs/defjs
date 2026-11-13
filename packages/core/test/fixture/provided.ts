import type {} from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    testServerHost: string;
    rawServerOrigin: string;
    refusedOrigin: string;
    fixtureToken: string;
  }
}
