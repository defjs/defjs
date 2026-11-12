import type { WebSocketHandleConstructor } from "../src/client";

/** A WebSocket handle that reports the url of every connection attempt and then refuses it. */
export function stoppingSocket(
  onUrl: (url: string) => void,
): WebSocketHandleConstructor {
  return class extends EventTarget {
    static readonly OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    protocol = "";
    extensions = "";
    binaryType = "blob";
    readonly url: string;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      onUrl(this.url);
      throw new Error("stop");
    }
    send(_data: string) {}
    close() {}
  };
}
