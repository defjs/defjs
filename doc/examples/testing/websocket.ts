// #region example
import { expect, test } from "vitest";
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketHandle,
  type Client,
  type WebSocketHandle,
} from "@defjs/core";

const liveQuotes = defineWebSocket({
  path: "/quotes",
  outgoing: struct.object({
    type: struct.literal("subscribe"),
    symbol: struct.string(),
  }),
  incoming: struct.object({
    symbol: struct.string(),
    priceCents: struct.number().alias("price_cents"),
  }),
});

export async function readFirstQuote(
  client: Client,
  symbol: string,
): Promise<[Error, undefined] | [null, number]> {
  const [err, session] = await liveQuotes(client);
  if (err) {
    return [new Error("connect quotes", { cause: err }), undefined];
  }

  await using ownedSession = session;
  let runtimeError: unknown;
  const unsubscribe = ownedSession.onRuntimeError((cause) => {
    runtimeError ??= cause;
  });
  try {
    ownedSession.send({ type: "subscribe", symbol });
    for await (const quote of ownedSession.receive) {
      if (quote.symbol === symbol) {
        return [null, quote.priceCents];
      }
    }
  } catch (cause) {
    return [new Error("read quote", { cause }), undefined];
  } finally {
    unsubscribe();
  }
  return [
    new Error(
      "quote stream ended before a quote arrived",
      runtimeError ? { cause: runtimeError } : undefined,
    ),
    undefined,
  ];
}

function makeFakeQuoteSocket(sent: string[]) {
  return class FakeQuoteSocket extends EventTarget implements WebSocketHandle {
    static readonly OPEN = 1;

    readonly url: string;
    readonly protocol = "";
    readonly extensions = "";
    readonly bufferedAmount = 0;
    readyState = 0;

    constructor(url: string) {
      super();
      this.url = url;
      queueMicrotask(() => {
        this.readyState = FakeQuoteSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (typeof data === "string") {
        sent.push(data);
        queueMicrotask(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ symbol: "ACME", price_cents: 1850 }),
            }),
          );
        });
      }
    }

    close(code = 1000, reason = ""): void {
      this.readyState = 3;
      queueMicrotask(() => {
        this.dispatchEvent(
          new CloseEvent("close", { code, reason, wasClean: true }),
        );
      });
    }
  };
}

test("readFirstQuote sends a subscription and returns the first quote price", async () => {
  const sent: string[] = [];
  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withWebSocketHandle(makeFakeQuoteSocket(sent)),
  );

  const [err, priceCents] = await readFirstQuote(client, "ACME");
  expect(err).toBeNull();
  if (err) throw err;
  expect(priceCents).toBe(1850);
  expect(sent).toEqual(['{"type":"subscribe","symbol":"ACME"}']);
});
// #endregion
