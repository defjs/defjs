/** Wire format between the in-browser specs and the Node side that drives Playwright. */
export type Handle = number | "browser";

export interface Step {
  name: string;
  /** Absent for a property read such as `page.keyboard`. */
  args?: Encoded[];
}

export interface Ref {
  handle: Handle;
  steps: Step[];
}

export type Encoded =
  | string
  | number
  | boolean
  | null
  | undefined
  | Encoded[]
  | { __fn: string }
  | { __re: [string, string] }
  | { __ref: Ref }
  | { [key: string]: Encoded };

export type Reply =
  { kind: "value"; value: unknown } | { kind: "handle"; handle: number };

export type ExtensionName = "errors" | "requests" | "hold";

declare module "vitest/browser" {
  interface BrowserCommands {
    e2eOpen: () => Promise<string>;
    e2eCall: (token: string, ref: Ref) => Promise<Reply>;
    e2eExtend: (
      token: string,
      name: ExtensionName,
      page: Ref,
      ...options: Encoded[]
    ) => Promise<number>;
    e2eClose: (token: string) => Promise<void>;
  }
}

declare module "vitest" {
  interface ProvidedContext {
    siteUrl: string;
  }
}
