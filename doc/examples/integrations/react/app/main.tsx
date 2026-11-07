// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { ClientProvider } from "@defjs/react";
import { OrderCard } from "./OrderCard.tsx";

const client = createClient(withEndpoint("https://api.example.com"));

export function App() {
  return (
    <ClientProvider client={client}>
      <OrderCard id={42} />
    </ClientProvider>
  );
}
// #endregion
