import { describe, expect, inject, test } from 'vitest'

describe('xsrf server endpoints', () => {
  const host = inject('testServerHost')

  test('should issue XSRF-TOKEN cookie and return token', async () => {
    const response = await fetch(`${host}/xsrf-token`)

    expect(response.status).toBe(200)

    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('XSRF-TOKEN=')
    expect(setCookie).toContain('SameSite=Strict')

    const { token } = (await response.json()) as { token: string }
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  test('should accept matching cookie and header', async () => {
    const tokenResponse = await fetch(`${host}/xsrf-token`)
    const { token } = (await tokenResponse.json()) as { token: string }
    const cookie = tokenResponse.headers.get('set-cookie') ?? ''

    const response = await fetch(`${host}/xsrf-validate`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-XSRF-TOKEN': token,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test('should reject when header is missing', async () => {
    const tokenResponse = await fetch(`${host}/xsrf-token`)
    const cookie = tokenResponse.headers.get('set-cookie') ?? ''

    const response = await fetch(`${host}/xsrf-validate`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, reason: 'missing token' })
  })

  test('should reject when cookie and header mismatch', async () => {
    const tokenResponse = await fetch(`${host}/xsrf-token`)
    const cookie = tokenResponse.headers.get('set-cookie') ?? ''

    const response = await fetch(`${host}/xsrf-validate`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-XSRF-TOKEN': 'forged-token',
      },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, reason: 'token mismatch' })
  })

  test('should support custom cookie and header names', async () => {
    const tokenResponse = await fetch(`${host}/xsrf-token?cookieName=CUSTOM-XSRF&headerName=X-CUSTOM-TOKEN`)
    const { token } = (await tokenResponse.json()) as { token: string }
    const cookie = tokenResponse.headers.get('set-cookie') ?? ''

    expect(cookie).toContain('CUSTOM-XSRF=')

    const response = await fetch(`${host}/xsrf-validate?cookieName=CUSTOM-XSRF&headerName=X-CUSTOM-TOKEN`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CUSTOM-TOKEN': token,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
