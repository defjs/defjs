import { expect, vi } from 'vitest'
import { supportsStreamingRequestBody } from '../src/http/transport/fetch_init'

export function installProbeRequest(contentType?: string, onConstruct?: () => void): void {
  class ProbeRequest {
    body: ReadableStream<Uint8Array> | null = null
    headers = new Headers()

    constructor(_input: string | URL, init?: RequestInit) {
      onConstruct?.()
      if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => {
          this.headers.set(key, value)
        })
      }
      if (init?.body instanceof ReadableStream) {
        this.body = init.body
        if (contentType !== undefined && !this.headers.has('content-type')) {
          this.headers.set('content-type', contentType)
        }
      }
    }
  }

  vi.stubGlobal('Request', ProbeRequest)
}

// Cache false from a Firefox-like probe, then restore Request so the real constructor is used while streaming stays unsupported.
export function simulateUnsupportedStreaming(): void {
  installProbeRequest('text/plain;charset=UTF-8')
  expect(supportsStreamingRequestBody()).toBe(false)
  vi.unstubAllGlobals()
}
