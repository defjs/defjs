import type {
  PortDisconnectListener,
  PortEndpoint,
  PortLike,
  PortMessageListener,
  PortWireMode,
} from "../types";

export interface NormalizedPort {
  readonly mode: PortWireMode | undefined;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onMessage: (listener: PortMessageListener) => () => void;
  onDisconnect?: (listener: PortDisconnectListener) => () => void;
  ensureConnected?: () => void;
}

function isPortEndpoint(port: PortLike): port is PortEndpoint {
  return "onMessage" in port;
}

export function normalizePort(port: PortLike): NormalizedPort {
  if (isPortEndpoint(port)) {
    const { onDisconnect, ensureConnected } = port;
    return {
      mode: port.mode,
      postMessage: (message, transfer) => port.postMessage(message, transfer),
      onMessage: (listener) => port.onMessage(listener),
      onDisconnect: onDisconnect
        ? (listener) => onDisconnect(listener)
        : undefined,
      ensureConnected: ensureConnected ? () => ensureConnected() : undefined,
    };
  }

  return {
    mode: "structured",
    postMessage: (message, transfer) => {
      if (transfer !== undefined && transfer.length > 0) {
        port.postMessage(message, transfer);
      } else {
        port.postMessage(message);
      }
    },
    onMessage: (listener) => {
      const handler = (event: MessageEvent): void => {
        listener(event.data);
      };
      port.addEventListener("message", handler);
      port.start();
      return () => {
        port.removeEventListener("message", handler);
      };
    },
  };
}
