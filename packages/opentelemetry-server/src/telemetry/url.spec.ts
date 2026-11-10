import { describe, expect, test } from "vitest";
import { resolveHttpUrl, resolveWebSocketUrl, serverAttributes } from "./url";

const resolveUrlText = (endpoint: string, baseEndpoint?: string): string =>
  resolveHttpUrl(endpoint, baseEndpoint).url;

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

describe("userinfo redaction", () => {
  const redactedBase = "http://REDACTED:REDACTED@api.example.com:8080/v1/test";

  test.each([
    "http://user:pw@api.example.com:8080/v1",
    "http://user@api.example.com:8080/v1",
    "http://:pw@api.example.com:8080/v1",
    "http://us%40er:p%40ss@api.example.com:8080/v1",
  ])("resolveUrl replaces the userinfo of %s", (base) => {
    const url = resolveUrlText("/test", base);
    expect(url).toBe(redactedBase);
    expect(url).not.toMatch(/user|pw|pass|us%40er|p%40ss/);
  });

  test("resolveHttpUrl replaces the userinfo and keeps server attributes", () => {
    const result = resolveHttpUrl(
      "/test",
      "http://user:pw@api.example.com:8080/v1",
    );
    expect(result.url).toBe(redactedBase);
    expect(result.serverAddress).toBe("api.example.com");
    expect(result.serverPort).toBe(8080);
  });

  test("replaces userinfo carried by an absolute endpoint", () => {
    expect(
      resolveUrlText("https://u:p@h.example/x", "https://api.example.com"),
    ).toBe("https://REDACTED:REDACTED@h.example/x");
  });

  test.each([
    { name: "no base", base: undefined },
    { name: "an invalid base", base: "not-a-url" },
  ])("replaces userinfo in an absolute endpoint with $name", ({ base }) => {
    expect(resolveUrlText("https://u:p@h.example/x", base)).toBe(
      "https://REDACTED:REDACTED@h.example/x",
    );
    expect(resolveHttpUrl("https://u:p@h.example/x", base).url).toBe(
      "https://REDACTED:REDACTED@h.example/x",
    );
  });

  test.each([
    "/test",
    "https://H.Example",
    "not a url",
    "https://h.example/a b",
  ])("returns a credential-free fallback endpoint %s untouched", (endpoint) => {
    expect(resolveUrlText(endpoint)).toBe(endpoint);
    expect(resolveHttpUrl(endpoint).url).toBe(endpoint);
  });
});

describe("userinfo redaction of an endpoint that cannot be parsed", () => {
  test.each([
    {
      endpoint: "http://u:SECRETPW@h.example:99999/x",
      expected: "http://REDACTED:REDACTED@h.example:99999/x",
    },
    {
      endpoint: "//u:SECRETPW@h.example/x?sig=abc#f",
      expected: "//REDACTED:REDACTED@h.example/x?sig=REDACTED#f",
    },
    {
      endpoint: "http:\\\\u:SECRETPW@h.example:99999/x",
      expected: "http:\\\\REDACTED:REDACTED@h.example:99999/x",
    },
  ])("rewrites $endpoint", ({ endpoint, expected }) => {
    for (const base of [undefined, "https://api.example.com"]) {
      expect(resolveUrlText(endpoint, base)).toBe(expected);
      expect(resolveHttpUrl(endpoint, base).url).toBe(expected);
    }
  });

  test.each(["//@h.example/x", "//h.example/a@b", "/a@b", "x//u:p@h"])(
    "leaves %s untouched",
    (endpoint) => {
      expect(resolveUrlText(endpoint)).toBe(endpoint);
    },
  );
});

describe("sensitive query redaction", () => {
  test.each([
    "X-Amz-Signature",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
    "AWSAccessKeyId",
    "Signature",
    "sig",
    "X-Goog-Signature",
  ])("replaces the value of %s and keeps the key", (key) => {
    expect(resolveUrlText(`https://h.example/x?color=blue&${key}=secret`)).toBe(
      `https://h.example/x?color=blue&${key}=REDACTED`,
    );
    expect(resolveUrlText(`/x?${key}=secret&color=blue`)).toBe(
      `/x?${key}=REDACTED&color=blue`,
    );
  });

  test("matches keys case-sensitively on the decoded name", () => {
    expect(
      resolveUrlText("https://h.example/x?SIG=a&Sig=b&%73ig=c&sig=d&sigx=e"),
    ).toBe(
      "https://h.example/x?SIG=a&Sig=b&%73ig=REDACTED&sig=REDACTED&sigx=e",
    );
  });

  test("redacts a valueless key and skips empty or unrelated parameters", () => {
    expect(resolveUrlText("https://h.example/x?flag&&sig&a=1")).toBe(
      "https://h.example/x?flag&&sig=REDACTED&a=1",
    );
  });

  test("redacts a query on the same URL as userinfo", () => {
    expect(resolveUrlText("https://u:p@h.example/x?sig=abc&a=1")).toBe(
      "https://REDACTED:REDACTED@h.example/x?sig=REDACTED&a=1",
    );
    expect(resolveHttpUrl("https://u:p@h.example/x?sig=abc").url).toBe(
      "https://REDACTED:REDACTED@h.example/x?sig=REDACTED",
    );
  });

  test("redacts text before the fragment and ignores a '?' inside it", () => {
    expect(resolveUrlText("/x?sig=abc#frag?sig=keep")).toBe(
      "/x?sig=REDACTED#frag?sig=keep",
    );
    expect(resolveUrlText("/x#frag?sig=keep")).toBe("/x#frag?sig=keep");
    expect(resolveUrlText("/x?")).toBe("/x?");
  });

  test("keeps the spelling of a parsed endpoint with a harmless query", () => {
    expect(resolveUrlText("https://H.Example/x?a=1")).toBe(
      "https://H.Example/x?a=1",
    );
  });

  test("a rooted path resolved against a base never carries a query", () => {
    expect(resolveUrlText("/x", "https://api.example.com/v1?sig=abc")).toBe(
      "https://api.example.com/v1/x",
    );
  });
});
