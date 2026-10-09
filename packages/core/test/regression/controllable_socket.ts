import { expect, vi } from 'vitest'

export interface ControllableSocket {
  binaryType: string
  bufferedAmount: number
  extensions: string
  protocol: string
  readyState: number
  readonly sent: string[]
  url: string
  close(code?: number, reason?: string): void
  send(data: string): void
  triggerClose(event: { code: number; reason: string; wasClean: boolean }): void
  triggerMessage(data: unknown): void
  triggerOpen(): void
}

export interface ControllableSocketClass {
  new (url: string, protocols?: string | string[]): ControllableSocket
  readonly CLOSED: number
  readonly CLOSING: number
  readonly CONNECTING: number
  readonly OPEN: number
}

export function createControllableSocketClass(): {
  Socket: ControllableSocketClass
  latest: () => ControllableSocket | undefined
} {
  let latest: ControllableSocket | undefined

  class Socket implements ControllableSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    binaryType = 'blob'
    bufferedAmount = 0
    extensions = ''
    protocol: string
    readyState = Socket.CONNECTING
    readonly sent: string[] = []
    url: string

    private readonly listeners: { [type: string]: Array<(event: unknown) => void> } = Object.create(null)

    constructor(url: string, protocols?: string | string[]) {
      this.url = url
      this.protocol = Array.isArray(protocols) ? (protocols[0] ?? '') : (protocols ?? '')
      remember(this)
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      ;(this.listeners[type] ??= []).push(listener)
    }

    removeEventListener(type: string, listener: (event: unknown) => void): void {
      this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener)
    }

    send(data: string): void {
      this.sent.push(String(data))
    }

    close(): void {
      this.readyState = Socket.CLOSING
    }

    triggerOpen(): void {
      this.readyState = Socket.OPEN
      this.emit('open', {})
    }

    triggerMessage(data: unknown): void {
      this.emit('message', { data })
    }

    triggerClose(event: { code: number; reason: string; wasClean: boolean }): void {
      this.readyState = Socket.CLOSED
      this.emit('close', event)
    }

    private emit(type: string, event: unknown): void {
      for (const listener of [...(this.listeners[type] ?? [])]) {
        listener(event)
      }
    }
  }

  return { Socket, latest: () => latest }

  function remember(socket: ControllableSocket): void {
    latest = socket
  }
}

export async function openControllableSocket<T>(pending: Promise<T>, latest: () => ControllableSocket | undefined): Promise<T> {
  await vi.waitFor(() => expect(latest()).toBeDefined())
  const socket = latest()
  if (!socket) {
    throw new Error('Expected socket')
  }
  socket.triggerOpen()
  return pending
}
