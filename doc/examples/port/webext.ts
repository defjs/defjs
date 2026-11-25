// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { attachPortHost, withPortTransport } from "@defjs/core/port";
import { fromWebExtPort, type WebExtPort } from "@defjs/core/port/webext";

// Background Service Worker host:
export function handleExtensionPort(rawPort: WebExtPort) {
  const endpoint = fromWebExtPort(rawPort);
  return attachPortHost(endpoint, {
    allowedOrigins: ["https://api.example.com"],
  });
}

// Popup / Side Panel / Content Script client (lazy reconnect on SW wake):
export function createExtensionClient(connectPort: () => WebExtPort) {
  const endpoint = fromWebExtPort(connectPort);
  return createClient(
    withEndpoint("https://api.example.com"),
    withPortTransport(endpoint),
  );
}
// #endregion
