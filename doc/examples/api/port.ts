// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { attachPortHost, withPortTransport } from "@defjs/core/port";
import { fromWebExtPort, type WebExtPort } from "@defjs/core/port/webext";

const channel = new MessageChannel();
using host = attachPortHost(channel.port1, {
  allowedOrigins: ["https://api.example.com"],
});

const client = createClient(
  withEndpoint("https://api.example.com"),
  withPortTransport(channel.port2),
);

export function bridgeExtensionPort(connectPort: () => WebExtPort) {
  return createClient(
    withEndpoint("https://api.example.com"),
    withPortTransport(fromWebExtPort(connectPort)),
  );
}
// #endregion
