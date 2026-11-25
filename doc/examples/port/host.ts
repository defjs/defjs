// #region example
import { attachPortHost } from "@defjs/core/port";

export function mountOrdersPortHost(port: MessagePort) {
  return attachPortHost(port, {
    allowedOrigins: ["https://api.example.com"],
    allowRequest: ({ transport, url, method }) =>
      transport === "http" &&
      method === "GET" &&
      url.pathname.startsWith("/orders/"),
  });
}
// #endregion
