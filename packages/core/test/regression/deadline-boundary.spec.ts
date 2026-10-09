import { expect, test, vi } from 'vitest'
import { createClient, createHttpInterceptor, defineRequest, withEndpoint, withInterceptors } from '../../src'

test('a one-millisecond deadline can settle before the interceptor announces startup', async () => {
  const interceptor = vi.fn(async () => new Promise<never>(() => undefined))
  const client = createClient(withEndpoint('https://example.test'), withInterceptors(createHttpInterceptor(interceptor)))
  const endpoint = defineRequest({ method: 'GET', path: '/probe' })
  const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(1002)
  try {
    const [fault] = await client.execute(endpoint(), { timeout: 1 })
    expect(fault?.code).toBe('NET_TIMEOUT')
    expect(interceptor).not.toHaveBeenCalled()
  } finally {
    now.mockRestore()
  }
})
