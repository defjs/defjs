// Proxy buffering hides client disconnects from local test servers.
const existing =
  `${Bun.env["NO_PROXY"] ?? ""},${Bun.env["no_proxy"] ?? ""}`.split(",");
const hosts = [...existing, "localhost", "127.0.0.1", "::1"]
  .map((host) => host.trim())
  .filter(Boolean);
Bun.env["NO_PROXY"] = [...new Set(hosts)].join(",");
Bun.env["no_proxy"] = Bun.env["NO_PROXY"];
