import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

export function registerXsrfRoutes(app: Hono): void {
  app.get('/xsrf-token', (c) => {
    const cookieName = c.req.query('cookieName') ?? 'XSRF-TOKEN'
    const token = randomUUID()

    setCookie(c, cookieName, token, {
      path: '/',
      sameSite: 'Strict',
      httpOnly: false,
    })

    return c.json({ token })
  })

  app.post('/xsrf-validate', async (c) => {
    const cookieName = c.req.query('cookieName') ?? 'XSRF-TOKEN'
    const headerName = c.req.query('headerName') ?? 'X-XSRF-TOKEN'
    const cookieToken = getCookie(c, cookieName)
    const headerToken = c.req.header(headerName)

    if (!cookieToken || !headerToken) {
      return c.json({ ok: false, reason: 'missing token' }, 403)
    }

    if (cookieToken !== headerToken) {
      return c.json({ ok: false, reason: 'token mismatch' }, 403)
    }

    return c.json({ ok: true })
  })
}
