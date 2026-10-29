// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { ClientProvider } from "@defjs/react";
import type { ReactNode } from "react";

const client = createClient(withEndpoint("https://api.example.com"));

export function ApiProvider({ children }: { children: ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>;
}
// #endregion
