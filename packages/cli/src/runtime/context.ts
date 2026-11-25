import type { ApplicationContext } from "@stricli/core";
import type { CliIo } from "./types.ts";

export interface DefjsCliContext extends ApplicationContext {
  readonly io: CliIo;
}
