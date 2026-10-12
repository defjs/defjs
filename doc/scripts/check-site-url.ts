const value = process.env['SITE_URL']
if (!value) throw new Error('SITE_URL must be set to the confirmed production HTTPS origin')
const url = new URL(value)
if (
  url.protocol !== 'https:' ||
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  url.pathname !== '/' ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
)
  throw new Error('SITE_URL must be a production HTTPS origin without path, query or credentials')
