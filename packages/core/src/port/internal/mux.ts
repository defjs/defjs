import type { PortLike, PortWireMode } from "../types";
import type { NormalizedPort } from "./endpoint";
import { normalizePort } from "./endpoint";
import type { PortFrame } from "./protocol";
import { parseFrame } from "./protocol";

export interface MuxChannelHandlers {
  readonly onFrame: (frame: PortFrame) => void;
  readonly onDisconnect: (reason: string) => void;
}

export class PortMux {
  readonly port: NormalizedPort;
  readonly #channels = new Map<number, MuxChannelHandlers>();
  #nextId = 1;

  constructor(port: PortLike) {
    this.port = normalizePort(port);
    this.port.onMessage((raw) => {
      const frame = parseFrame(raw);
      if (frame === undefined) {
        return;
      }
      if (frame.kind === "port.close") {
        this.#failAll("Port closed by host");
        return;
      }
      const channel = this.#channels.get(frame.id);
      channel?.onFrame(frame);
    });
    this.port.onDisconnect?.(() => {
      this.#failAll("Port disconnected");
    });
  }

  get defaultMode(): PortWireMode | undefined {
    return this.port.mode;
  }

  openChannel(handlers: MuxChannelHandlers): number {
    this.port.ensureConnected?.();
    const id = this.#nextId;
    this.#nextId += 1;
    this.#channels.set(id, handlers);
    return id;
  }

  deleteChannel(id: number): void {
    this.#channels.delete(id);
  }

  send(frame: PortFrame, transfer?: Transferable[]): void {
    this.port.postMessage(frame, transfer);
  }

  trySend(frame: PortFrame, transfer?: Transferable[]): void {
    try {
      this.port.postMessage(frame, transfer);
    } catch {
      // Best-effort abort/close notifications must not mask existing channel failure or throw during cleanup.
    }
  }

  #failAll(reason: string): void {
    const active = [...this.#channels.values()];
    this.#channels.clear();
    for (const handlers of active) {
      handlers.onDisconnect(reason);
    }
  }
}

const sharedMuxes = new WeakMap<PortLike, PortMux>();

export function getPortMux(port: PortLike): PortMux {
  const existing = sharedMuxes.get(port);
  if (existing !== undefined) {
    return existing;
  }
  const mux = new PortMux(port);
  sharedMuxes.set(port, mux);
  return mux;
}
