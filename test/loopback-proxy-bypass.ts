// Proxy buffering hides client disconnects from local test servers.
const existing =
  `${process.env["NO_PROXY"] ?? ""},${process.env["no_proxy"] ?? ""}`.split(
    ",",
  );
const hosts = [...existing, "localhost", "127.0.0.1", "::1"]
  .map((host) => host.trim())
  .filter(Boolean);
process.env["NO_PROXY"] = [...new Set(hosts)].join(",");
process.env["no_proxy"] = process.env["NO_PROXY"];
