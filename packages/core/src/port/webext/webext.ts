import type {
  PortDisconnectListener,
  PortEndpoint,
  PortMessageListener,
  PortWireMode,
} from "../types";

/**
 * Minimal event subscription surface compatible with WebExtension `runtime.Port.onMessage` and `runtime.Port.onDisconnect`.
 *
 * Declared structurally without requiring `@types/chrome` or `webextension-polyfill`.
 *
 * @group port
 */
export interface WebExtEvent<TListener> {
  /** Registers a listener with the extension port event. */
  addListener: (listener: TListener) => void;
  /** Unregisters a previously added listener from the extension port event. */
  removeListener: (listener: TListener) => void;
}

/**
 * Minimal WebExtension `runtime.Port` structural interface accepted by {@link fromWebExtPort}.
 *
 * @group port
 */
export interface WebExtPort {
  /** Optional port channel name assigned during `runtime.connect`. */
  readonly name?: string;
  /** Sends a JSON-serializable frame to the extension peer (`chrome.runtime.Port.postMessage`). */
  postMessage: (message: unknown) => void;
  /** Event fired when a message arrives from the extension peer. */
  readonly onMessage: WebExtEvent<(message: unknown) => void>;
  /** Event fired when the extension peer disconnects or the MV3 Service Worker suspends. */
  readonly onDisconnect: WebExtEvent<() => void>;
}

/**
 * Options accepted by {@link fromWebExtPort}.
 *
 * @group port
 */
export interface WebExtPortOptions {
  /** Wire encoding mode for the endpoint. Defaults to `"json"`, which chunks and Base64-encodes binary payloads for extension IPC. */
  readonly mode?: PortWireMode;
}

/**
 * Adapts a WebExtension `runtime.Port` instance or lazy connector callback into a {@link PortEndpoint}.
 *
 * - Pass a lazy factory (`() => chrome.runtime.connect({ name: "defjs-proxy" })`) on extension UI or content-script clients: connects lazily on first operation call and reconnects automatically after MV3 Service Worker hibernation disconnects.
 * - Pass a concrete `WebExtPort` instance inside `chrome.runtime.onConnect`: attaches immediately to that peer connection without automatic reconnection after disconnect.
 *
 * Defaults to `mode: "json"` and sends single-argument `postMessage` frames compatible with Chromium, Firefox, and Safari WebExtensions.
 *
 * @param portOrConnect - Connected `WebExtPort` or factory returning a new `WebExtPort`.
 * @param options - Endpoint encoding mode (`"json"` by default).
 * @returns A {@link PortEndpoint} accepted by `withPortTransport` and `attachPortHost`.
 * @group port
 */
export function fromWebExtPort(
  portOrConnect: WebExtPort | (() => WebExtPort),
  options?: WebExtPortOptions,
): PortEndpoint {
  const mode = options?.mode ?? "json";
  const connect =
    typeof portOrConnect === "function" ? portOrConnect : undefined;
  const messageListeners = new Set<PortMessageListener>();
  const disconnectListeners = new Set<PortDisconnectListener>();

  let activePort: WebExtPort | undefined;

  const attach = (rawPort: WebExtPort): WebExtPort => {
    const onMessage = (data: unknown): void => {
      for (const listener of [...messageListeners]) {
        listener(data);
      }
    };
    const onDisconnect = (): void => {
      rawPort.onMessage.removeListener(onMessage);
      rawPort.onDisconnect.removeListener(onDisconnect);
      activePort = undefined;
      for (const listener of [...disconnectListeners]) {
        listener();
      }
    };
    rawPort.onMessage.addListener(onMessage);
    rawPort.onDisconnect.addListener(onDisconnect);
    activePort = rawPort;
    return rawPort;
  };

  if (typeof portOrConnect !== "function") {
    attach(portOrConnect);
  }

  const ensureActive = (): WebExtPort => {
    if (activePort !== undefined) {
      return activePort;
    }
    if (connect === undefined) {
      throw new Error("WebExtension port is disconnected");
    }
    return attach(connect());
  };

  return {
    mode,
    ensureConnected() {
      ensureActive();
    },
    postMessage(message) {
      ensureActive().postMessage(message);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => {
        disconnectListeners.delete(listener);
      };
    },
  };
}
