import { expect, vi } from "vitest";

export interface ControllableSocket {
  binaryType: string;
  bufferedAmount: number;
  extensions: string;
  protocol: string;
  readyState: number;
  readonly sent: string[];
  url: string;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  triggerClose(event: {
    code: number;
    reason: string;
    wasClean: boolean;
  }): void;
  triggerMessage(data: unknown): void;
  triggerOpen(): void;
}

export function createControllableSocketClass() {
  let latest: ControllableSocket | undefined;

  class Socket implements ControllableSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    binaryType = "blob";
    bufferedAmount = 0;
    extensions = "";
    protocol: string;
    readyState = Socket.CONNECTING;
    readonly sent: string[] = [];
    url: string;

    private readonly listeners = new Map<
      string,
      Array<(event: unknown) => void>
    >();

    constructor(url: string, protocols?: string | string[]) {
      this.url = url;
      this.protocol = Array.isArray(protocols)
        ? (protocols[0] ?? "")
        : (protocols ?? "");
      remember(this);
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      const current = this.listeners.get(type);
      if (current) current.push(listener);
      else this.listeners.set(type, [listener]);
    }

    removeEventListener(
      type: string,
      listener: (event: unknown) => void,
    ): void {
      const current = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        current.filter((item) => item !== listener),
      );
    }

    send(data: string): void {
      this.sent.push(String(data));
    }

    close(): void {
      this.readyState = Socket.CLOSING;
    }

    triggerOpen(): void {
      this.readyState = Socket.OPEN;
      this.emit("open", {});
    }

    triggerMessage(data: unknown): void {
      this.emit("message", { data });
    }

    triggerClose(event: {
      code: number;
      reason: string;
      wasClean: boolean;
    }): void {
      this.readyState = Socket.CLOSED;
      this.emit("close", event);
    }

    private emit(type: string, event: unknown): void {
      for (const listener of [...(this.listeners.get(type) ?? [])]) {
        listener(event);
      }
    }
  }

  return { Socket, latest: () => latest };

  function remember(socket: ControllableSocket): void {
    latest = socket;
  }
}

export async function openControllableSocket<T>(
  pending: Promise<T>,
  latest: () => ControllableSocket | undefined,
): Promise<T> {
  await vi.waitFor(() => expect(latest()).toBeDefined());
  const socket = latest();
  if (!socket) {
    throw new Error("Expected socket");
  }
  socket.triggerOpen();
  return pending;
}
