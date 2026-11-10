import { describe, expect, test } from "vitest";
import { resolveHttpUrl, resolveWebSocketUrl, serverAttributes } from "./url";

describe("resolveHttpUrl", () => {
  test("returns endpoint when no baseEndpoint", () => {
    const result = resolveHttpUrl("/test");
    expect(result.url).toBe("/test");
    expect(result.serverAddress).toBeUndefined();
    expect(result.serverPort).toBeUndefined();
  });

  test("resolves with hostname and the scheme default port", () => {
    const result = resolveHttpUrl("/test", "https://api.example.com");
    expect(result.url).toBe("https://api.example.com/test");
    expect(result.serverAddress).toBe("api.example.com");
    expect(result.serverPort).toBe(443);
  });

  test.each([
    ["https://api.example.com", 443],
    ["http://api.example.com", 80],
    ["wss://api.example.com", 443],
    ["ws://api.example.com", 80],
    ["https://api.example.com:443/v1", 443],
    ["http://api.example.com:80", 80],
    ["https://api.example.com:8080", 8080],
    ["http://api.example.com:443", 443],
    ["ftp://files.example.com", undefined],
  ])("reports server.port for %s as %s", (base, port) => {
    expect(resolveHttpUrl("/test", base).serverPort).toBe(port);
  });

  test("keeps the square brackets of an IPv6 host, as URL.hostname does", () => {
    const result = resolveHttpUrl("/v1", "https://[::1]:8443");
    expect(result.serverAddress).toBe("[::1]");
    expect(result.serverPort).toBe(8443);
  });

  test("reports the scheme default port for an IPv6 host without a port", () => {
    const result = resolveHttpUrl("/v1", "https://[2001:db8::1]");
    expect(result.serverAddress).toBe("[2001:db8::1]");
    expect(result.serverPort).toBe(443);
  });

  test("keeps base pathname when joining a rooted path", () => {
    const result = resolveHttpUrl("/users", "https://api.example.com/staging");
    expect(result.url).toBe("https://api.example.com/staging/users");
    expect(result.serverAddress).toBe("api.example.com");
  });

  test("resolves with explicit port", () => {
    const result = resolveHttpUrl("/test", "https://api.example.com:8080");
    expect(result.url).toBe("https://api.example.com:8080/test");
    expect(result.serverAddress).toBe("api.example.com");
    expect(result.serverPort).toBe(8080);
  });

  test("returns endpoint on invalid baseEndpoint", () => {
    const result = resolveHttpUrl("/test", "not-a-url");
    expect(result.url).toBe("/test");
    expect(result.serverAddress).toBeUndefined();
    expect(result.serverPort).toBeUndefined();
  });
});

describe("resolveWebSocketUrl", () => {
  test("returns endpoint when no baseEndpoint", () => {
    expect(resolveWebSocketUrl("/ws")).toEqual({ url: "/ws" });
  });

  test.each([
    ["https://api.example.com", "wss://api.example.com/ws", 443],
    ["http://localhost:8080", "ws://localhost:8080/ws", 8080],
    ["http://api.example.com", "ws://api.example.com/ws", 80],
    ["wss://api.example.com", "wss://api.example.com/ws", 443],
    ["ws://api.example.com:9000", "ws://api.example.com:9000/ws", 9000],
  ])("maps base %s to the connection URL %s", (base, url, serverPort) => {
    const result = resolveWebSocketUrl("/ws", base);
    expect(result.url).toBe(url);
    expect(result.serverPort).toBe(serverPort);
    expect(result.serverAddress).toBe(new URL(url).hostname);
  });

  test("keeps base pathname when joining a rooted path", () => {
    expect(
      resolveWebSocketUrl("/users", "https://api.example.com/staging").url,
    ).toBe("wss://api.example.com/staging/users");
  });

  test("returns endpoint on invalid baseEndpoint", () => {
    expect(resolveWebSocketUrl("/ws", "not-a-url")).toEqual({ url: "/ws" });
  });
});

describe("serverAttributes", () => {
  test.each([
    [{ serverAddress: "api.example.com", serverPort: 443 }, true, true],
    [{ serverAddress: "api.example.com" }, true, false],
    [{ serverPort: 443 }, false, true],
    [{}, false, false],
  ])("writes only the parts of %j that exist", (resolved, address, port) => {
    expect(serverAttributes(resolved)).toEqual({
      ...(address ? { "server.address": "api.example.com" } : {}),
      ...(port ? { "server.port": 443 } : {}),
    });
  });
});
